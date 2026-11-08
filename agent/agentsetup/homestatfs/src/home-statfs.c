/*
 * btop's view of the workspace's home volume, preloaded by the btop wrapper
 * that agent-setup writes (agent/agentsetup/btop.go).
 *
 * On a cluster whose volumes are folders of the node's disk (local-path, the
 * hostpath provisioner: minikube, kind), statfs() of the home answers for the
 * node's whole disk, hundreds of GB. For a path in the home this answers with
 * the volume's own size and the home's measured usage instead, as the
 * workspace's Disk metric does: `coder stat workspace disk` writes them to
 * /tmp/coder-home-disk ("<total> <used>", bytes) while the home's filesystem is
 * far larger than its claim, and removes the file otherwise. Any other path,
 * or no such file, is answered as the kernel answers it.
 *
 * It is built once for each architecture with no C library headers and no
 * dlsym: it calls the kernel directly, so the same file works with glibc and
 * musl. The structure layouts below are the kernel's and the C libraries'
 * for 64-bit Linux, the same on x86_64 and aarch64. Regenerate the embedded
 * libraries with generate.sh (beside this file) after editing.
 */

typedef unsigned long u64;

#if defined(__x86_64__)
#define SYS_read 0
#define SYS_close 3
#define SYS_statfs 137
#define SYS_openat 257
static long sys3(long n, long a, long b, long c)
{
	long ret;
	__asm__ volatile("syscall"
			 : "=a"(ret)
			 : "a"(n), "D"(a), "S"(b), "d"(c)
			 : "rcx", "r11", "memory");
	return ret;
}
static long sys4(long n, long a, long b, long c, long d)
{
	long ret;
	register long r10 __asm__("r10") = d;
	__asm__ volatile("syscall"
			 : "=a"(ret)
			 : "a"(n), "D"(a), "S"(b), "d"(c), "r"(r10)
			 : "rcx", "r11", "memory");
	return ret;
}
#elif defined(__aarch64__)
#define SYS_openat 56
#define SYS_close 57
#define SYS_read 63
#define SYS_statfs 43
static long sys4(long n, long a, long b, long c, long d)
{
	register long x8 __asm__("x8") = n;
	register long x0 __asm__("x0") = a;
	register long x1 __asm__("x1") = b;
	register long x2 __asm__("x2") = c;
	register long x3 __asm__("x3") = d;
	__asm__ volatile("svc 0"
			 : "+r"(x0)
			 : "r"(x8), "r"(x1), "r"(x2), "r"(x3)
			 : "memory");
	return x0;
}
static long sys3(long n, long a, long b, long c) { return sys4(n, a, b, c, 0); }
#else
#error "home-statfs supports x86_64 and aarch64"
#endif

#define AT_FDCWD (-100)
#define ST_VALID 0x0020

/* The kernel's struct statfs, which is also the C libraries' on 64-bit Linux. */
struct kstatfs {
	long f_type;
	long f_bsize;
	u64 f_blocks, f_bfree, f_bavail, f_files, f_ffree;
	int f_fsid[2];
	long f_namelen, f_frsize, f_flags;
	long f_spare[4];
};

/* glibc's and musl's struct statvfs on 64-bit Linux. */
struct cstatvfs {
	u64 f_bsize, f_frsize;
	u64 f_blocks, f_bfree, f_bavail;
	u64 f_files, f_ffree, f_favail;
	u64 f_fsid, f_flag, f_namemax;
	int spare[6];
};

extern char *getenv(const char *name);
extern int *__errno_location(void);

static int fail(long ret)
{
	*__errno_location() = (int)-ret;
	return -1;
}

static unsigned long length(const char *s)
{
	unsigned long n = 0;
	while (s[n])
		n++;
	return n;
}

/* A path in the home: the home itself, or under it. */
static int in_home(const char *path)
{
	const char *home = getenv("HOME");
	unsigned long n, i;
	if (!path || !home || !*home)
		return 0;
	n = length(home);
	while (n > 1 && home[n - 1] == '/')
		n--;
	for (i = 0; i < n; i++)
		if (path[i] != home[i])
			return 0;
	return path[n] == '\0' || path[n] == '/';
}

/* The volume's size and the home's usage, as the Disk metric measured them last. */
static int volume(u64 *total, u64 *used)
{
	char buf[64];
	long fd, n, i = 0;
	u64 *field = total;
	fd = sys4(SYS_openat, AT_FDCWD, (long)"/tmp/coder-home-disk", 0, 0);
	if (fd < 0)
		return 0;
	n = sys3(SYS_read, fd, (long)buf, sizeof(buf) - 1);
	sys3(SYS_close, fd, 0, 0);
	if (n <= 0)
		return 0;
	buf[n] = '\0';
	*total = *used = 0;
	for (; i < n; i++) {
		char c = buf[i];
		if (c >= '0' && c <= '9') {
			*field = *field * 10 + (u64)(c - '0');
		} else if (c == ' ' && field == total) {
			field = used;
		} else {
			break;
		}
	}
	return field == used && *total > 0 && *used <= *total;
}

static int kernel_statfs(const char *path, struct kstatfs *st)
{
	long ret = sys3(SYS_statfs, (long)path, (long)st, 0);
	if (ret < 0)
		return fail(ret);
	if (in_home(path)) {
		u64 total, used, unit = (u64)(st->f_frsize ? st->f_frsize : st->f_bsize);
		if (unit > 0 && volume(&total, &used)) {
			st->f_blocks = total / unit;
			st->f_bfree = (total - used) / unit;
			st->f_bavail = st->f_bfree;
		}
	}
	return 0;
}

__attribute__((visibility("default"))) int statfs(const char *path, struct kstatfs *buf)
{
	return kernel_statfs(path, buf);
}

__attribute__((visibility("default"))) int statfs64(const char *path, struct kstatfs *buf)
{
	return kernel_statfs(path, buf);
}

__attribute__((visibility("default"))) int statvfs(const char *path, struct cstatvfs *buf)
{
	struct kstatfs st;
	int i;
	if (kernel_statfs(path, &st) != 0)
		return -1;
	buf->f_bsize = (u64)st.f_bsize;
	buf->f_frsize = (u64)(st.f_frsize ? st.f_frsize : st.f_bsize);
	buf->f_blocks = st.f_blocks;
	buf->f_bfree = st.f_bfree;
	buf->f_bavail = st.f_bavail;
	buf->f_files = st.f_files;
	buf->f_ffree = st.f_ffree;
	buf->f_favail = st.f_ffree;
	buf->f_fsid = (u64)(unsigned int)st.f_fsid[0] | ((u64)(unsigned int)st.f_fsid[1] << 32);
	buf->f_flag = (u64)st.f_flags & ~(u64)ST_VALID;
	buf->f_namemax = (u64)st.f_namelen;
	for (i = 0; i < 6; i++)
		buf->spare[i] = 0;
	return 0;
}

__attribute__((visibility("default"))) int statvfs64(const char *path, struct cstatvfs *buf)
{
	return statvfs(path, buf);
}
