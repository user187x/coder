#!/usr/bin/env python3
"""Fixed guest source entrypoint; configuration paths cannot be supplied by users."""
import sys
sys.path.insert(0, '/usr/local/lib/coder-vm')
from private_config import source_main

if __name__ == '__main__':
    sys.exit(source_main())
