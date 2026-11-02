CLANG ?= clang
LIBS := -lbpf -lelf
ARCH = x86


all: privilege_escalation_monitor_kern.o privilege_escalation_monitor

clean:
	rm -f *.o
	rm -f cred_monitor.skel.h

vmlinux.h:
	bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h

privilege_escalation_monitor_kern.o: privilege_escalation_monitor_kern.c vmlinux.h
	$(CLANG) -g -O2 -Wall -target bpf -D__TARGET_ARCH_$(ARCH) -D__KERNEL__ -c $< -o $@

privilege_escalation_monitor: privilege_escalation_monitor_user.c
	$(CC) -g -Wall $< -o $@ $(LIBS)
