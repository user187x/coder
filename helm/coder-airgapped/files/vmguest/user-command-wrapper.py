#!/usr/bin/env python3
"""Fixed private QGA entrypoint for authorized user commands inside Sysbox."""
import sys
sys.path.insert(0, '/usr/local/lib/coder-vm')
from user_command import main

if __name__ == '__main__':
    sys.exit(main())
