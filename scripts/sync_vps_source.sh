#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/sync_vps_source.sh [--apply] [--delete] [--dest USER@HOST:/path/]

Safely sync this source checkout to the VPS using .rsyncignore.

Default mode is a dry run. Add --apply to perform the sync.
The default destination is root@45.32.63.217:/root/mtips5s_note_lm_pro/.

Examples:
  scripts/sync_vps_source.sh
  scripts/sync_vps_source.sh --apply
  scripts/sync_vps_source.sh --apply --dest root@45.32.63.217:/root/mtips5s_note_lm_pro/
EOF
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${VPS_SYNC_DEST:-root@45.32.63.217:/root/mtips5s_note_lm_pro/}"
ssh_cmd="${VPS_SYNC_SSH:-ssh -o ClearAllForwardings=yes}"
dry_run=1
delete_remote=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      dry_run=0
      shift
      ;;
    --delete)
      delete_remote=1
      shift
      ;;
    --dest)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --dest" >&2
        usage >&2
        exit 2
      fi
      dest="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "${repo_root}/.rsyncignore" ]]; then
  echo "Missing ${repo_root}/.rsyncignore" >&2
  exit 1
fi

rsync_args=(
  -az
  --no-owner
  --no-group
  --human-readable
  --itemize-changes
  --stats
  --exclude-from="${repo_root}/.rsyncignore"
  -e "${ssh_cmd}"
)

if [[ "${dry_run}" == "1" ]]; then
  echo "Dry run only. Add --apply to sync files to the VPS."
  rsync_args+=(--dry-run)
fi

if [[ "${delete_remote}" == "1" ]]; then
  rsync_args+=(--delete)
fi

rsync \
  "${rsync_args[@]}" \
  "${repo_root}/" \
  "${dest}"
