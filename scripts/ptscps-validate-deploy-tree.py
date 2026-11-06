#!/usr/bin/env python3
"""Reject compiled links before zip can dereference paths outside deployment."""
from pathlib import Path


def main():
    root = Path('deploy')
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('Invalid deployment root or symlink')
    for path in root.rglob('*'):
        if path.is_symlink():
            raise RuntimeError('Compiled deployment symlink refused')
        if not path.is_dir() and not path.is_file():
            raise RuntimeError('Compiled deployment contains a non-regular item')
    print('PTSCPS_DEPLOY_TREE=PASS no-symlinks')


if __name__ == '__main__':
    main()
