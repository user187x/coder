#!/bin/bash
# The Serenade sidebar's applications (Miserable_Xfce's eww launcher, with the workspace's own): opened, the sidebar
# closes.

declare target

case $1 in
	--taskmanager) target="xfce4-taskmanager" ;;
	--filemanager) target="thunar" ;;
	--webbrowser) target="chromium" ;;
	--terminal) target="terminator" ;;
esac

[ -n "$target" ] && setsid gtk-launch "$target" >/dev/null 2>&1 &
eww close-all
