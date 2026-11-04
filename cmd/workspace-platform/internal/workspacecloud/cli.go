//go:build linux

package workspacecloud

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"

	"golang.org/x/term"
	"golang.org/x/xerrors"
)

func decisions(raw string, input io.Reader) (map[string]string, error) {
	reader := io.Reader(strings.NewReader(raw))
	if raw == "-" {
		reader = input
	}
	if n, ok := strings.CutPrefix(raw, "-:"); ok {
		size, err := strconv.ParseInt(n, 10, 64)
		if err != nil || size < 0 || size > 128<<20 {
			return nil, xerrors.New("invalid decision length")
		}
		reader = io.LimitReader(input, size)
	}
	var result map[string]string
	if err := json.NewDecoder(reader).Decode(&result); err != nil {
		return nil, err
	}
	for path, decision := range result {
		if decision != "overwrite" && decision != "keep" {
			return nil, xerrors.Errorf("invalid decision for %s", path)
		}
	}
	return result, nil
}

func choose(in *bufio.Reader, out io.Writer, question string, keys string) (byte, error) {
	for {
		_, _ = fmt.Fprint(out, question)
		text, err := in.ReadString('\n')
		if err != nil {
			return 0, err
		}
		text = strings.ToLower(strings.TrimSpace(text))
		if text == "" {
			return keys[0], nil
		}
		if strings.Contains(keys, text[:1]) {
			return text[0], nil
		}
	}
}

func askMount(p plan, input io.Reader, out io.Writer) (string, map[string]string, error) {
	if len(p.Collisions) == 0 {
		return "keep-both", nil, nil
	}
	file, ok := input.(*os.File)
	if !ok || !term.IsTerminal(int(file.Fd())) {
		return "", nil, xerrors.New("file names collide; run mount in a terminal, or pass --keep-both or --overwrite-all")
	}
	for _, c := range p.Collisions {
		_, _ = fmt.Fprintf(out, "%s: local %s, Cloud Drive %s\n", c.Path, c.Local, c.Cloud)
	}
	in := bufio.NewReader(input)
	key, err := choose(in, out, "[K]eep both or [O]verwrite? ", "ko")
	if err != nil || key == 'k' {
		return "keep-both", nil, err
	}
	key, err = choose(in, out, "Overwrite [A]ll or [P]rompt for each? ", "ap")
	if err != nil || key == 'a' {
		return "overwrite-all", nil, err
	}
	answers := map[string]string{}
	for _, c := range p.Collisions {
		key, err = choose(in, out, "Overwrite "+c.Path+"? [Y/n] ", "yn")
		if err != nil {
			return "", nil, err
		}
		answers[c.Path] = "keep"
		if key == 'y' {
			answers[c.Path] = "overwrite"
		}
	}
	return "ask", answers, nil
}

const usage = "cloud-drive mount PATH [--keep-both | --overwrite-all], unmount PATH, list, sync, plan PATH, or apply PATH --mode MODE"

// Command runs mount management as the workspace user, sharing the existing state and dashboard JSON contract.
func Command(args []string, in io.Reader, out io.Writer) error {
	if len(args) == 0 {
		return xerrors.New(usage)
	}
	if args[0] == "--help" || args[0] == "help" {
		_, _ = fmt.Fprintln(out, usage)
		return nil
	}
	jsonOutput := slices.Contains(args, "--json")
	args = slices.DeleteFunc(slices.Clone(args), func(v string) bool { return v == "--json" })
	if len(args) == 0 {
		return xerrors.New(usage)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	if home == "/" {
		home = "/home/coder"
	}
	d := newDrive(home)
	var result any
	err = d.transaction(func(s *mounts) error {
		if len(args) == 1 {
			switch args[0] {
			case "list":
				list := []map[string]any{}
				for _, m := range s.Mounts {
					list = append(list, map[string]any{"target": m.Target, "mode": m.Mode, "created": m.Created, "links": len(m.Links)})
					if !jsonOutput {
						_, _ = fmt.Fprintf(out, "%s (%s, %d links)\n", m.Target, m.Mode, len(m.Links))
					}
				}
				if !jsonOutput && len(list) == 0 {
					_, _ = fmt.Fprintln(out, "cloud-drive: mounted nowhere")
				}
				result = map[string]any{"cloud": isDir(d.cloud), "mounts": list}
				return nil
			case "sync":
				r, err := d.sync(s)
				result = r
				return err
			}
		}
		if len(args) < 2 {
			return xerrors.New(usage)
		}
		if !slices.Contains([]string{"unmount", "plan", "mount", "apply"}, args[0]) {
			return xerrors.New(usage)
		}
		target, err := d.target(args[1])
		if err != nil {
			return err
		}
		flags := flag.NewFlagSet("cloud-drive "+args[0], flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		mode := flags.String("mode", "ask", "collision mode")
		input := flags.String("decisions", "{}", "collision decisions")
		overwrite := flags.Bool("overwrite-all", false, "overwrite all")
		keep := flags.Bool("keep-both", false, "keep both")
		if err := flags.Parse(args[2:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return xerrors.New(usage)
		}
		switch args[0] {
		case "unmount":
			result, err = d.unmount(s, target)
			if err == nil && !jsonOutput {
				_, _ = fmt.Fprintf(out, "Unmounted the Cloud Drive from %s.\n", target)
			}
		case "plan":
			result, err = d.plan(target, s.find(target))
		case "apply", "mount":
			var selected map[string]string
			if args[0] == "apply" {
				selected, err = decisions(*input, in)
			} else {
				if *overwrite && *keep {
					return xerrors.New("choose one collision mode")
				}
				switch {
				case *overwrite:
					*mode = "overwrite-all"
				case *keep || jsonOutput:
					*mode = "keep-both"
				default:
					p, e := d.plan(target, s.find(target))
					if e != nil {
						return e
					}
					*mode, selected, err = askMount(p, in, out)
				}
			}
			if err != nil {
				return err
			}
			result, err = d.apply(s, target, *mode, selected, *mode)
			if err == nil && !jsonOutput {
				_, _ = fmt.Fprintf(out, "Mounted the Cloud Drive at %s.\n", target)
			}
		}
		return err
	})
	if !jsonOutput {
		return err
	}
	if err != nil {
		var missing unresolved
		if errors.As(err, &missing) {
			result = map[string]any{"halted": true, "unresolved": []string(missing)}
		} else {
			result = map[string]string{"error": err.Error()}
		}
	}
	return errors.Join(err, json.NewEncoder(out).Encode(result))
}
