/*
 * btop's view of the workspace's home volume (startup.sh builds this into ~/.cache/coder/home-statfs.so, and a btop
 * wrapper in ~/.local/bin preloads it). On a cluster whose volumes are folders of the node's disk - minikube's and
 * kind's local-path, the hostpath provisioner - statvfs() of the home answers for the node's whole disk, hundreds of
 * GB. For a path in the home this answers with the volume's own size and the home's measured usage instead, as the
 * workspace's Disk metric does: metadata.sh's disk() writes them to /tmp/coder-home-disk ("<total> <used>", bytes)
 * while the home's filesystem is far larger than its claim, and removes the file otherwise. Anything else - another
 * path, no such file - is answered as it is. On a real volume (EBS, Ceph...) there is no file: nothing changes.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>
#include <sys/vfs.h>

static const char *CACHE = "/tmp/coder-home-disk";

/* A path in the home (the home itself, or under it). */
static int in_home(const char *path)
{
	const char *home = getenv("HOME");
	size_t n;
	if (!path || !home || !*home)
		return 0;
	n = strlen(home);
	while (n > 1 && home[n - 1] == '/')
		n--;
	return strncmp(path, home, n) == 0 && (path[n] == '\0' || path[n] == '/');
}

/* The volume's size and the home's usage, as the Disk metric measured them last. */
static int volume(unsigned long long *total, unsigned long long *used)
{
	FILE *f = fopen(CACHE, "r");
	int ok;
	if (!f)
		return 0;
	ok = fscanf(f, "%llu %llu", total, used) == 2 && *total > 0 && *used <= *total;
	fclose(f);
	return ok;
}

#define ANSWER_FOR_HOME(buf, unit)                                   \
	do {                                                         \
		unsigned long long total, used;                      \
		if ((unit) > 0 && volume(&total, &used)) {           \
			(buf)->f_blocks = total / (unit);            \
			(buf)->f_bfree = (total - used) / (unit);    \
			(buf)->f_bavail = (buf)->f_bfree;            \
		}                                                    \
	} while (0)

int statvfs(const char *path, struct statvfs *buf)
{
	static int (*real)(const char *, struct statvfs *);
	int rc;
	if (!real)
		real = dlsym(RTLD_NEXT, "statvfs");
	rc = real(path, buf);
	if (rc == 0 && in_home(path))
		ANSWER_FOR_HOME(buf, buf->f_frsize ? buf->f_frsize : buf->f_bsize);
	return rc;
}

int statvfs64(const char *path, struct statvfs64 *buf)
{
	static int (*real)(const char *, struct statvfs64 *);
	int rc;
	if (!real)
		real = dlsym(RTLD_NEXT, "statvfs64");
	rc = real(path, buf);
	if (rc == 0 && in_home(path))
		ANSWER_FOR_HOME(buf, buf->f_frsize ? buf->f_frsize : buf->f_bsize);
	return rc;
}

int statfs(const char *path, struct statfs *buf)
{
	static int (*real)(const char *, struct statfs *);
	int rc;
	if (!real)
		real = dlsym(RTLD_NEXT, "statfs");
	rc = real(path, buf);
	if (rc == 0 && in_home(path))
		ANSWER_FOR_HOME(buf, (unsigned long long)buf->f_bsize);
	return rc;
}

int statfs64(const char *path, struct statfs64 *buf)
{
	static int (*real)(const char *, struct statfs64 *);
	int rc;
	if (!real)
		real = dlsym(RTLD_NEXT, "statfs64");
	rc = real(path, buf);
	if (rc == 0 && in_home(path))
		ANSWER_FOR_HOME(buf, (unsigned long long)buf->f_bsize);
	return rc;
}
