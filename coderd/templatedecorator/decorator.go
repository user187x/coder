// Package templatedecorator injects the platform's boilerplate into every
// template's Terraform when it is provisioned: the decorator pattern applied to
// templates.
//
// The platform's base template (the "UBUNTU" prototype the chart pushes, named
// by TemplateBuilder.BaseTemplate) marks its platform sections with comments:
//
//	# platform:begin <feature>
//	...
//	# platform:end <feature>
//
// at the top level, in its coder_agent, in its workload's pod template (the pod's
// metadata or spec) or in the container that runs the agent. Those sections,
// with the declarations they reference from the rest of the prototype and the
// scripts they read (scripts/<file>), are the payload (Extract). A template that
// lacks a feature gets its sections at the same places in its own files - the
// agent and its container found by what they reference - and their scripts as
// .platform/<file> (Decorate). Templates made from the prototype in the
// builder carry none of it (Strip): their code is their own logic only, and
// the platform's comes in when they are built. A template whose files say
// "# platform:no-decorator" is left as it is.
package templatedecorator

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
	"golang.org/x/xerrors"
)

const (
	beginMarker = "# platform:begin "
	endMarker   = "# platform:end "
	// OptOut in any of a template's .tf files leaves it undecorated.
	OptOut = "# platform:no-decorator"
	// ScriptDir is where the injected sections' scripts go in a decorated template.
	ScriptDir = ".platform"
	maxFile   = 10 << 20
)

// Placement is where a section goes in a template.
type Placement string

const (
	Top         Placement = "top"
	Agent       Placement = "agent"
	PodMetadata Placement = "pod-metadata"
	PodSpec     Placement = "pod-spec"
	Container   Placement = "container"
)

// Section is one marked region of the prototype.
type Section struct {
	Feature   string    `json:"feature"`
	Placement Placement `json:"placement"`
	// Text is the region's lines, its markers included.
	Text string `json:"text"`
}

// Payload is what the decorator injects: the prototype's platform sections.
type Payload struct {
	// Features in the prototype's order.
	Features []string  `json:"features"`
	Sections []Section `json:"sections"`
	// Files the sections read, by name (scripts/metadata.sh: "metadata.sh").
	Files map[string][]byte `json:"-"`
	// Requires: declarations outside the sections that they reference, by
	// reference ("var.namespace", "local.coder_host", "data.coder_workspace.me").
	Requires map[string]Requirement `json:"-"`
	// ImageExpr is the expression of the prototype's agent container's image:
	// a template's own takes its place in the injected sections.
	ImageExpr string `json:"-"`
	// VariableValues are the prototype version's variable values: an injected
	// variable's default.
	VariableValues map[string]string `json:"-"`
}

// Requirement is a declaration a section needs.
type Requirement struct {
	Kind string // variable, local, data
	Name string
	// Text: the block (a variable or a data source) or "name = expr" (a local).
	Text string
	// Type of a variable ("bool", "number", "string", ...).
	Type string
}

// Result is a decorated template's Terraform.
type Result struct {
	// Files: every .tf file, decorated where it changed.
	Files map[string][]byte `json:"-"`
	// Changed .tf files.
	Changed []string `json:"changed"`
	// Added: the scripts put in ScriptDir.
	Added []string `json:"added"`
	// Injected and Skipped features (with why).
	Injected []string `json:"injected"`
	Skipped  []Skip   `json:"skipped"`
}

// Skip is a feature not injected.
type Skip struct {
	Feature string `json:"feature"`
	Reason  string `json:"reason"`
}

var (
	scriptRef   = regexp.MustCompile(`\$\{path\.module\}/scripts/([A-Za-z0-9._-]+)`)
	featureName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	workloads   = map[string]bool{
		"kubernetes_deployment": true, "kubernetes_deployment_v1": true,
		"kubernetes_stateful_set": true, "kubernetes_stateful_set_v1": true,
		"kubernetes_daemonset": true, "kubernetes_daemon_set_v1": true,
		"kubernetes_job": true, "kubernetes_job_v1": true,
		"kubernetes_pod": true, "kubernetes_pod_v1": true,
	}
)

// ---------------------------------------------------------------------------------------------------- regions

type region struct {
	feature    string
	start, end int // 1-based line numbers of the markers
}

func regions(src []byte) ([]region, error) {
	var out []region
	var open *region
	for i, line := range strings.Split(string(src), "\n") {
		t := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(t, beginMarker):
			name := strings.TrimSpace(strings.TrimPrefix(t, beginMarker))
			if open != nil {
				return nil, xerrors.Errorf("line %d: platform section %q begins inside %q", i+1, name, open.feature)
			}
			if !featureName.MatchString(name) {
				return nil, xerrors.Errorf("line %d: %q is not a section name", i+1, name)
			}
			open = &region{feature: name, start: i + 1}
		case strings.HasPrefix(t, endMarker):
			name := strings.TrimSpace(strings.TrimPrefix(t, endMarker))
			if open == nil || open.feature != name {
				return nil, xerrors.Errorf("line %d: platform section %q ends without beginning", i+1, name)
			}
			open.end = i + 1
			out = append(out, *open)
			open = nil
		}
	}
	if open != nil {
		return nil, xerrors.Errorf("platform section %q has no end", open.feature)
	}
	return out, nil
}

// blockPath is the chain of blocks from the file down to one.
type blockPath []*hclsyntax.Block

func (p blockPath) kinds() []string {
	out := make([]string, len(p))
	for i, b := range p {
		out[i] = b.Type
	}
	return out
}

// innermost: the blocks containing a line (outermost first).
func innermost(body *hclsyntax.Body, line int) blockPath {
	var path blockPath
	for {
		var next *hclsyntax.Block
		for _, b := range body.Blocks {
			r := b.Range()
			if r.Start.Line < line && line < r.End.Line {
				next = b
				break
			}
		}
		if next == nil {
			return path
		}
		path = append(path, next)
		body = next.Body
	}
}

// placementOf: where a line inside a prototype sits.
func placementOf(path blockPath) (Placement, error) {
	if len(path) == 0 {
		return Top, nil
	}
	root := path[0]
	if root.Type == "resource" && len(root.Labels) == 2 && root.Labels[0] == "coder_agent" && len(path) == 1 {
		return Agent, nil
	}
	if root.Type == "resource" && len(root.Labels) == 2 && workloads[root.Labels[0]] {
		pod := podSpecPrefix(root.Labels[0])
		kinds := path[1:].kinds()
		meta := append(append([]string{}, pod[:len(pod)-1]...), "metadata")
		switch {
		case equal(kinds, meta):
			return PodMetadata, nil
		case equal(kinds, pod):
			return PodSpec, nil
		case equal(kinds, append(append([]string{}, pod...), "container")):
			return Container, nil
		}
	}
	return "", xerrors.Errorf("a platform section inside %s: not a place the decorator knows", strings.Join(path.kinds(), " > "))
}

// podSpecPrefix: the blocks from a workload resource down to its pod spec.
func podSpecPrefix(kind string) []string {
	switch {
	case strings.HasPrefix(kind, "kubernetes_pod"):
		return []string{"spec"}
	case strings.HasPrefix(kind, "kubernetes_job"):
		return []string{"spec", "template", "spec"}
	default:
		return []string{"spec", "template", "spec"}
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func lines(src []byte) []string { return strings.Split(string(src), "\n") }

// ---------------------------------------------------------------------------------------------------- extract

// Extract reads the payload from the prototype: its main.tf, its other files
// (scripts/...), and its version's variable values.
func Extract(mainTF []byte, files map[string][]byte, variableValues map[string]string) (*Payload, error) {
	regs, err := regions(mainTF)
	if err != nil {
		return nil, err
	}
	file, diags := hclsyntax.ParseConfig(mainTF, "main.tf", hcl.InitialPos)
	if diags.HasErrors() {
		return nil, xerrors.Errorf("the base template's main.tf: %s", diags.Error())
	}
	body := file.Body.(*hclsyntax.Body)
	src := lines(mainTF)
	p := &Payload{Files: map[string][]byte{}, Requires: map[string]Requirement{}, VariableValues: variableValues}
	seen := map[string]bool{}
	for _, r := range regs {
		path := innermost(body, r.start)
		end := innermost(body, r.end)
		if len(end) != len(path) || (len(path) > 0 && end[len(end)-1] != path[len(path)-1]) {
			return nil, xerrors.Errorf("platform section %q (lines %d-%d) is not inside one block", r.feature, r.start, r.end)
		}
		place, err := placementOf(path)
		if err != nil {
			return nil, xerrors.Errorf("platform section %q: %w", r.feature, err)
		}
		text := strings.Join(src[r.start-1:r.end], "\n")
		p.Sections = append(p.Sections, Section{Feature: r.feature, Placement: place, Text: text})
		if !seen[r.feature] {
			seen[r.feature] = true
			p.Features = append(p.Features, r.feature)
		}
		for _, m := range scriptRef.FindAllStringSubmatch(text, -1) {
			data, ok := files["scripts/"+m[1]]
			if !ok {
				return nil, xerrors.Errorf("platform section %q reads scripts/%s, which the base template has not", r.feature, m[1])
			}
			p.Files[m[1]] = data
		}
	}
	p.ImageExpr = agentImageExpr(body, mainTF)
	if err := p.resolveRequires(body, mainTF, regs); err != nil {
		return nil, err
	}
	return p, nil
}

// agentImageExpr: the source text of the image of the container that runs the
// agent in the prototype's workload ("" when there is none).
func agentImageExpr(body *hclsyntax.Body, src []byte) string {
	w := findWorkload(body, agentNames(body))
	if w == nil || w.container == nil {
		return ""
	}
	if a, ok := w.container.Body.Attributes["image"]; ok {
		return strings.TrimSpace(string(a.Expr.Range().SliceBytes(src)))
	}
	return ""
}

// definedIn: what the sections declare themselves (var.x, local.x, data.t.n, t.n).
func definedIn(sections []Section) (map[string]bool, error) {
	out := map[string]bool{}
	for _, s := range sections {
		if s.Placement != Top {
			continue
		}
		f, diags := hclsyntax.ParseConfig([]byte(s.Text), s.Feature+".tf", hcl.InitialPos)
		if diags.HasErrors() {
			return nil, xerrors.Errorf("platform section %q: %s", s.Feature, diags.Error())
		}
		for _, b := range f.Body.(*hclsyntax.Body).Blocks {
			for _, k := range blockRefs(b) {
				out[k] = true
			}
		}
	}
	return out, nil
}

// blockRefs: how a top-level block is referred to.
func blockRefs(b *hclsyntax.Block) []string {
	switch {
	case b.Type == "variable" && len(b.Labels) == 1:
		return []string{"var." + b.Labels[0]}
	case b.Type == "locals":
		out := make([]string, 0, len(b.Body.Attributes))
		for name := range b.Body.Attributes {
			out = append(out, "local."+name)
		}
		return out
	case b.Type == "data" && len(b.Labels) == 2:
		return []string{"data." + b.Labels[0] + "." + b.Labels[1]}
	case b.Type == "resource" && len(b.Labels) == 2:
		return []string{b.Labels[0] + "." + b.Labels[1]}
	}
	return nil
}

// references: what a piece of HCL refers to (var.x, local.x, data.t.n, t.n).
func references(text string, name string) ([]string, error) {
	f, diags := hclsyntax.ParseConfig([]byte(text), name, hcl.InitialPos)
	if diags.HasErrors() {
		return nil, xerrors.Errorf("%s: %s", name, diags.Error())
	}
	set := map[string]bool{}
	iterators := map[string]bool{}
	_ = hclsyntax.VisitAll(f.Body.(*hclsyntax.Body), func(n hclsyntax.Node) hcl.Diagnostics {
		if b, ok := n.(*hclsyntax.Block); ok && b.Type == "dynamic" && len(b.Labels) == 1 {
			iterators[b.Labels[0]] = true
			if it, ok := b.Body.Attributes["iterator"]; ok {
				if v := hcl.ExprAsKeyword(it.Expr); v != "" {
					iterators[v] = true
				}
			}
		}
		return nil
	})
	_ = hclsyntax.VisitAll(f.Body.(*hclsyntax.Body), func(n hclsyntax.Node) hcl.Diagnostics {
		if e, ok := n.(hclsyntax.Expression); ok {
			for _, t := range e.Variables() {
				if ref := refOf(t); ref != "" && !iterators[t.RootName()] {
					set[ref] = true
				}
			}
		}
		return nil
	})
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out, nil
}

func refOf(t hcl.Traversal) string {
	root := t.RootName()
	attr := func(i int) string {
		if len(t) > i {
			if a, ok := t[i].(hcl.TraverseAttr); ok {
				return a.Name
			}
		}
		return ""
	}
	switch root {
	case "var", "local":
		if a := attr(1); a != "" {
			return root + "." + a
		}
	case "data":
		if a, b := attr(1), attr(2); a != "" && b != "" {
			return "data." + a + "." + b
		}
	case "path", "count", "each", "self", "terraform", "module":
		return ""
	default:
		if a := attr(1); a != "" {
			return root + "." + a
		}
	}
	return ""
}

// resolveRequires: the declarations outside the sections that they (and those
// declarations, in turn) reference.
func (p *Payload) resolveRequires(body *hclsyntax.Body, src []byte, regs []region) error {
	defined, err := definedIn(p.Sections)
	if err != nil {
		return err
	}
	inRegion := func(r hcl.Range) bool {
		for _, g := range regs {
			if r.Start.Line >= g.start && r.End.Line <= g.end {
				return true
			}
		}
		return false
	}
	// the prototype's own declarations, outside the sections
	decls := map[string]Requirement{}
	for _, b := range body.Blocks {
		if inRegion(b.Range()) {
			continue
		}
		text := string(b.Range().SliceBytes(src))
		switch {
		case b.Type == "variable" && len(b.Labels) == 1:
			typ := ""
			if a, ok := b.Body.Attributes["type"]; ok {
				typ = strings.TrimSpace(string(a.Expr.Range().SliceBytes(src)))
			}
			decls["var."+b.Labels[0]] = Requirement{Kind: "variable", Name: b.Labels[0], Text: text, Type: typ}
		case b.Type == "data" && len(b.Labels) == 2:
			decls["data."+b.Labels[0]+"."+b.Labels[1]] = Requirement{Kind: "data", Name: b.Labels[0] + "." + b.Labels[1], Text: text}
		case b.Type == "locals":
			for name, a := range b.Body.Attributes {
				if inRegion(a.SrcRange) {
					continue
				}
				decls["local."+name] = Requirement{Kind: "local", Name: name,
					Text: name + " = " + strings.TrimSpace(string(a.Expr.Range().SliceBytes(src)))}
			}
		}
	}
	queue := []string{}
	for _, s := range p.Sections {
		refs, err := references(s.Text, s.Feature+".tf")
		if err != nil {
			return err
		}
		queue = append(queue, refs...)
	}
	for len(queue) > 0 {
		ref := queue[0]
		queue = queue[1:]
		if defined[ref] || p.Requires[ref].Kind != "" || ref == p.ImageExpr {
			continue
		}
		if strings.HasPrefix(ref, "coder_agent.") {
			continue // the template's own agent, at injection
		}
		d, ok := decls[ref]
		if !ok {
			if strings.HasPrefix(ref, "var.") || strings.HasPrefix(ref, "local.") || strings.HasPrefix(ref, "data.") {
				return xerrors.Errorf("the platform sections use %s, which the base template does not declare", ref)
			}
			return xerrors.Errorf("the platform sections use the resource %s outside them: they must not", ref)
		}
		p.Requires[ref] = d
		text := d.Text
		if d.Kind == "local" {
			text = "locals {\n" + d.Text + "\n}"
		}
		refs, err := references(text, ref)
		if err != nil {
			return err
		}
		queue = append(queue, refs...)
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------- strip

// Strip is the prototype without its platform sections, and the files only they
// read (to leave out of a template made from it).
func Strip(mainTF []byte) ([]byte, []string, error) {
	regs, err := regions(mainTF)
	if err != nil {
		return nil, nil, err
	}
	src := lines(mainTF)
	drop := make([]bool, len(src)+1)
	var removedText strings.Builder
	for _, r := range regs {
		for i := r.start; i <= r.end; i++ {
			drop[i] = true
			removedText.WriteString(src[i-1])
			removedText.WriteByte('\n')
		}
	}
	var kept []string
	for i, l := range src {
		if !drop[i+1] {
			kept = append(kept, l)
		}
	}
	out := collapseBlankLines(strings.Join(kept, "\n"))
	// the scripts only the sections read
	still := map[string]bool{}
	for _, m := range scriptRef.FindAllStringSubmatch(out, -1) {
		still[m[1]] = true
	}
	only := map[string]bool{}
	for _, m := range scriptRef.FindAllStringSubmatch(removedText.String(), -1) {
		if !still[m[1]] {
			only["scripts/"+m[1]] = true
		}
	}
	files := make([]string, 0, len(only))
	for f := range only {
		files = append(files, f)
	}
	sort.Strings(files)
	return hclwrite.Format([]byte(out)), files, nil
}

func collapseBlankLines(s string) string {
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return strings.TrimLeft(s, "\n")
}

// ---------------------------------------------------------------------------------------------------- decorate

type workload struct {
	file      string
	resource  *hclsyntax.Block
	podSpec   *hclsyntax.Block
	podMeta   *hclsyntax.Block // nil: none yet
	template  *hclsyntax.Block // the block that holds the pod's metadata (nil for a pod: the resource)
	container *hclsyntax.Block
}

// insertion: text put at an offset of a file.
type insertion struct {
	file   string
	offset int
	index  int
	text   string
	// replace this many bytes at offset (an annotations attribute merged)
	replace int
}

func agentNames(body *hclsyntax.Body) []string {
	var out []string
	for _, b := range body.Blocks {
		if b.Type == "resource" && len(b.Labels) == 2 && b.Labels[0] == "coder_agent" {
			out = append(out, b.Labels[1])
		}
	}
	return out
}

func childBlock(body *hclsyntax.Body, kind string) *hclsyntax.Block {
	for _, b := range body.Blocks {
		if b.Type == kind {
			return b
		}
	}
	return nil
}

// findWorkload: the first workload resource whose pod has a container; the
// agent's container is the one that references one of the agents (its init
// script, its token), else the first.
func findWorkload(body *hclsyntax.Body, agents []string) *workload {
	for _, b := range body.Blocks {
		if b.Type != "resource" || len(b.Labels) != 2 || !workloads[b.Labels[0]] {
			continue
		}
		w := &workload{resource: b}
		cur := b.Body
		prefix := podSpecPrefix(b.Labels[0])
		ok := true
		for i, k := range prefix {
			nb := childBlock(cur, k)
			if nb == nil {
				ok = false
				break
			}
			if i == len(prefix)-2 {
				w.template = nb
			}
			cur = nb.Body
			if i == len(prefix)-1 {
				w.podSpec = nb
			}
		}
		if !ok || w.podSpec == nil {
			continue
		}
		if w.template == nil {
			w.template = b // a pod: its own metadata
		}
		w.podMeta = childBlock(w.template.Body, "metadata")
		var first *hclsyntax.Block
		for _, c := range w.podSpec.Body.Blocks {
			if c.Type != "container" {
				continue
			}
			if first == nil {
				first = c
			}
			if referencesAgent(c, agents) {
				w.container = c
				break
			}
		}
		if w.container == nil {
			w.container = first
		}
		if w.container != nil {
			return w
		}
	}
	return nil
}

func referencesAgent(c *hclsyntax.Block, agents []string) bool {
	names := map[string]bool{}
	for _, a := range agents {
		names[a] = true
	}
	found := false
	_ = hclsyntax.VisitAll(c.Body, func(n hclsyntax.Node) hcl.Diagnostics {
		if e, ok := n.(hclsyntax.Expression); ok {
			for _, t := range e.Variables() {
				if t.RootName() == "coder_agent" && len(t) > 1 {
					if a, ok := t[1].(hcl.TraverseAttr); ok && names[a.Name] {
						found = true
					}
				}
			}
		}
		return nil
	})
	return found
}

// tfFile is a parsed .tf file of the template.
type tfFile struct {
	name string
	src  []byte
	body *hclsyntax.Body
}

// Decorate injects the payload's features the template's .tf files lack.
func (p *Payload) Decorate(files map[string][]byte) (*Result, error) {
	res := &Result{Files: map[string][]byte{}}
	var tfs []*tfFile
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	optOut := false
	all := &strings.Builder{}
	for _, name := range names {
		res.Files[name] = files[name]
		if path.Dir(name) != "." || !strings.HasSuffix(name, ".tf") {
			continue
		}
		if bytes.Contains(files[name], []byte(OptOut)) {
			optOut = true
		}
		f, diags := hclsyntax.ParseConfig(files[name], name, hcl.InitialPos)
		if diags.HasErrors() {
			// the template's own error: Terraform reports it, undecorated
			return p.skipAll(res, "the template's Terraform does not parse ("+name+")"), nil
		}
		tfs = append(tfs, &tfFile{name: name, src: files[name], body: f.Body.(*hclsyntax.Body)})
		all.Write(files[name])
		all.WriteByte('\n')
	}
	if optOut {
		return p.skipAll(res, "the template opts out ("+OptOut+")"), nil
	}
	// the agents and the workload
	var agentFile *tfFile
	var agents []string
	for _, f := range tfs {
		if a := agentNames(f.body); len(a) > 0 && agentFile == nil {
			agentFile, agents = f, a
		}
	}
	if agentFile == nil {
		return p.skipAll(res, "the template has no coder_agent"), nil
	}
	var wl *workload
	var wlFile *tfFile
	for _, f := range tfs {
		if w := findWorkload(f.body, agents); w != nil {
			wl, wlFile = w, f
			w.file = f.name
			break
		}
	}
	defined := map[string]bool{}
	for _, f := range tfs {
		for _, b := range f.body.Blocks {
			for _, k := range blockRefs(b) {
				defined[k] = true
			}
		}
	}
	text := all.String()
	var ins []insertion
	used := map[string]bool{}
	var injectedSections []Section
	for _, feature := range p.Features {
		if hasFeature(text, feature) {
			res.Skipped = append(res.Skipped, Skip{Feature: feature, Reason: "the template has it"})
			continue
		}
		secs := p.sectionsOf(feature)
		needsPod := false
		for _, s := range secs {
			if s.Placement != Top && s.Placement != Agent {
				needsPod = true
			}
		}
		if clash := p.clashes(secs, defined); clash != "" {
			res.Skipped = append(res.Skipped, Skip{Feature: feature, Reason: "the template declares " + clash + " itself"})
			continue
		}
		if needsPod && wl == nil {
			res.Skipped = append(res.Skipped, Skip{Feature: feature, Reason: "no Kubernetes pod runs the agent"})
			continue
		}
		for _, s := range secs {
			body := p.rewrite(s.Text, agents[0], wl, wlFile)
			switch s.Placement {
			case Top:
				body = p.withDefaults(body)
				ins = append(ins, insertion{file: agentFile.name, offset: len(agentFile.src), text: "\n" + body + "\n"})
			case Agent:
				for _, b := range agentFile.body.Blocks {
					if b.Type == "resource" && len(b.Labels) == 2 && b.Labels[0] == "coder_agent" {
						if t := withoutDuplicates(body, b, agentFile.src, s.Feature); t != "" {
							ins = append(ins, insertion{file: agentFile.name, offset: b.CloseBraceRange.Start.Byte, text: "\n" + t + "\n"})
						}
					}
				}
			case PodSpec:
				if t := withoutDuplicates(body, wl.podSpec, wlFile.src, s.Feature); t != "" {
					ins = append(ins, insertion{file: wlFile.name, offset: wl.podSpec.CloseBraceRange.Start.Byte, text: "\n" + t + "\n"})
				}
			case Container:
				if t := withoutDuplicates(body, wl.container, wlFile.src, s.Feature); t != "" {
					ins = append(ins, insertion{file: wlFile.name, offset: wl.container.CloseBraceRange.Start.Byte, text: "\n" + t + "\n"})
				}
			case PodMetadata:
				in, err := p.metadataInsertion(body, wl, wlFile)
				if err != nil {
					return nil, err
				}
				ins = append(ins, in)
			}
			for _, m := range scriptRef.FindAllStringSubmatch(s.Text, -1) {
				used[m[1]] = true
			}
			injectedSections = append(injectedSections, s)
		}
		for _, s := range secs {
			if s.Placement == Top {
				f, _ := hclsyntax.ParseConfig([]byte(s.Text), "s.tf", hcl.InitialPos)
				for _, b := range f.Body.(*hclsyntax.Body).Blocks {
					for _, k := range blockRefs(b) {
						defined[k] = true
					}
				}
			}
		}
		res.Injected = append(res.Injected, feature)
	}
	if len(res.Injected) == 0 {
		return res, nil
	}
	// what the injected sections need that the template does not declare
	if req := p.requirements(injectedSections, defined); req != "" {
		ins = append(ins, insertion{file: agentFile.name, offset: len(agentFile.src), text: "\n" + req + "\n"})
	}
	byFile := map[string][]insertion{}
	for i, in := range ins {
		in.index = i
		byFile[in.file] = append(byFile[in.file], in)
	}
	for name, list := range byFile {
		src := append([]byte{}, files[name]...)
		// from the end, so the offsets hold; at one offset, the last first (they keep their order)
		sort.Slice(list, func(i, j int) bool {
			if list[i].offset != list[j].offset {
				return list[i].offset > list[j].offset
			}
			return list[i].index > list[j].index
		})
		for _, in := range list {
			src = append(src[:in.offset:in.offset], append([]byte(in.text), src[in.offset+in.replace:]...)...)
		}
		out := hclwrite.Format(src)
		if _, diags := hclsyntax.ParseConfig(out, name, hcl.InitialPos); diags.HasErrors() {
			return nil, xerrors.Errorf("the decorated %s does not parse: %s", name, diags.Error())
		}
		res.Files[name] = out
		res.Changed = append(res.Changed, name)
	}
	sort.Strings(res.Changed)
	for name := range used {
		target := ScriptDir + "/" + name
		res.Files[target] = p.Files[name]
		res.Added = append(res.Added, target)
	}
	sort.Strings(res.Added)
	return res, nil
}

// blockIdentity: what makes a nested block the same as another - an agent's
// metadata by its key, a pod's init container, volume, a container's mount or
// env by its name (dynamic ones by their content's) - or "" (no identity: kept).
func blockIdentity(b *hclsyntax.Block, src []byte) string {
	kind, body := b.Type, b.Body
	if b.Type == "dynamic" && len(b.Labels) == 1 {
		kind = b.Labels[0]
		if c := childBlock(b.Body, "content"); c != nil {
			body = c.Body
		}
	}
	for _, attr := range []string{"key", "name"} {
		if a, ok := body.Attributes[attr]; ok {
			return kind + "/" + attr + "=" + strings.TrimSpace(string(a.Expr.Range().SliceBytes(src)))
		}
	}
	return ""
}

// withoutDuplicates: a nested section's blocks the target block lacks (a
// template with the platform's code from before the decorator has it, unmarked):
// the section as it is when none is there yet, "" when every one is.
func withoutDuplicates(section string, target *hclsyntax.Block, src []byte, feature string) string {
	have := map[string]bool{}
	for _, b := range target.Body.Blocks {
		if id := blockIdentity(b, src); id != "" {
			have[id] = true
		}
	}
	f, diags := hclsyntax.ParseConfig([]byte(section), "section.tf", hcl.InitialPos)
	if diags.HasErrors() {
		return section
	}
	body := f.Body.(*hclsyntax.Body)
	var keep []string
	dup := false
	for _, b := range body.Blocks {
		if id := blockIdentity(b, []byte(section)); id != "" && have[id] {
			dup = true
			continue
		}
		keep = append(keep, string(b.Range().SliceBytes([]byte(section))))
	}
	if !dup {
		return section
	}
	if len(keep) == 0 || len(body.Attributes) > 0 {
		return ""
	}
	return beginMarker + feature + "\n" + strings.Join(keep, "\n") + "\n" + endMarker + feature
}

// hasFeature: the template has the feature's sections already (its own, or a decorated copy).
func hasFeature(text, feature string) bool {
	return regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(beginMarker+feature) + `\s*$`).MatchString(text)
}

func (p *Payload) skipAll(res *Result, why string) *Result {
	for _, f := range p.Features {
		res.Skipped = append(res.Skipped, Skip{Feature: f, Reason: why})
	}
	return res
}

func (p *Payload) sectionsOf(feature string) []Section {
	var out []Section
	for _, s := range p.Sections {
		if s.Feature == feature {
			out = append(out, s)
		}
	}
	return out
}

// clashes: a top-level declaration of the feature the template has already.
func (p *Payload) clashes(secs []Section, defined map[string]bool) string {
	for _, s := range secs {
		if s.Placement != Top {
			continue
		}
		f, diags := hclsyntax.ParseConfig([]byte(s.Text), "s.tf", hcl.InitialPos)
		if diags.HasErrors() {
			continue
		}
		for _, b := range f.Body.(*hclsyntax.Body).Blocks {
			for _, k := range blockRefs(b) {
				if defined[k] {
					return k
				}
			}
		}
	}
	return ""
}

// rewrite: a section's text for the template: its agent, its container's image,
// the scripts' place.
func (p *Payload) rewrite(text, agent string, wl *workload, wlFile *tfFile) string {
	text = regexp.MustCompile(`\bcoder_agent\.main\b`).ReplaceAllString(text, "coder_agent."+agent)
	text = strings.ReplaceAll(text, "${path.module}/scripts/", "${path.module}/"+ScriptDir+"/")
	if p.ImageExpr != "" && wl != nil && wl.container != nil {
		if a, ok := wl.container.Body.Attributes["image"]; ok {
			own := strings.TrimSpace(string(a.Expr.Range().SliceBytes(wlFile.src)))
			text = regexp.MustCompile(`(=\s*)`+regexp.QuoteMeta(p.ImageExpr)+`\b`).ReplaceAllString(text, "${1}"+own)
		}
	}
	return text
}

// metadataInsertion: the pod's annotations, merged with the template's own.
func (p *Payload) metadataInsertion(body string, wl *workload, f *tfFile) (insertion, error) {
	parsed, diags := hclsyntax.ParseConfig([]byte(body), "metadata.tf", hcl.InitialPos)
	if diags.HasErrors() {
		return insertion{}, xerrors.Errorf("a pod-metadata section: %s", diags.Error())
	}
	pb := parsed.Body.(*hclsyntax.Body)
	ann, ok := pb.Attributes["annotations"]
	if !ok || len(pb.Attributes) != 1 || len(pb.Blocks) != 0 {
		return insertion{}, xerrors.New("a pod-metadata section must be one annotations attribute")
	}
	expr := strings.TrimSpace(string(ann.Expr.Range().SliceBytes([]byte(body))))
	if wl.podMeta == nil {
		return insertion{file: f.name, offset: wl.template.OpenBraceRange.End.Byte,
			text: "\nmetadata {\n" + body + "\n}\n"}, nil
	}
	own, ok := wl.podMeta.Body.Attributes["annotations"]
	if !ok {
		return insertion{file: f.name, offset: wl.podMeta.CloseBraceRange.Start.Byte, text: "\n" + body + "\n"}, nil
	}
	r := own.Expr.Range()
	ownExpr := strings.TrimSpace(string(r.SliceBytes(f.src)))
	return insertion{file: f.name, offset: r.Start.Byte, replace: r.End.Byte - r.Start.Byte,
		text: "merge(" + ownExpr + ", " + expr + ") # platform: cloud-drive and the template's own"}, nil
}

// requirements: the declarations the injected sections need that the template
// lacks, a variable's default being the prototype's value.
func (p *Payload) requirements(secs []Section, defined map[string]bool) string {
	need := map[string]bool{}
	var queue []string
	for _, s := range secs {
		refs, _ := references(s.Text, s.Feature)
		queue = append(queue, refs...)
	}
	for len(queue) > 0 {
		ref := queue[0]
		queue = queue[1:]
		r, ok := p.Requires[ref]
		if !ok || need[ref] || defined[ref] {
			continue
		}
		need[ref] = true
		text := r.Text
		if r.Kind == "local" {
			text = "locals {\n" + r.Text + "\n}"
		}
		refs, _ := references(text, ref)
		queue = append(queue, refs...)
	}
	if len(need) == 0 {
		return ""
	}
	keys := make([]string, 0, len(need))
	for k := range need {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString("# platform:begin requires\n# What the platform's sections use that this template does not declare.\n")
	var locals []string
	for _, k := range keys {
		r := p.Requires[k]
		switch r.Kind {
		case "variable":
			b.WriteString(p.variable(r))
			b.WriteString("\n\n")
		case "data":
			b.WriteString(r.Text)
			b.WriteString("\n\n")
		case "local":
			locals = append(locals, r.Text)
		}
	}
	if len(locals) > 0 {
		b.WriteString("locals {\n" + strings.Join(locals, "\n") + "\n}\n")
	}
	b.WriteString("# platform:end requires\n")
	return b.String()
}

// withDefaults: a top-level section with each variable it declares defaulting to
// the prototype's value (the deployment's configuration, as the chart pushed it).
func (p *Payload) withDefaults(text string) string {
	if len(p.VariableValues) == 0 || !strings.Contains(text, "variable") {
		return text
	}
	f, diags := hclwrite.ParseConfig([]byte(text), "section.tf", hcl.InitialPos)
	if diags.HasErrors() {
		return text
	}
	changed := false
	for _, blk := range f.Body().Blocks() {
		if blk.Type() != "variable" || len(blk.Labels()) != 1 {
			continue
		}
		if _, ok := p.VariableValues[blk.Labels()[0]]; !ok {
			continue
		}
		typ := ""
		if a := blk.Body().GetAttribute("type"); a != nil {
			typ = strings.TrimSpace(string(a.Expr().BuildTokens(nil).Bytes()))
		}
		v := strings.TrimSpace(p.variable(Requirement{Kind: "variable", Name: blk.Labels()[0], Type: typ,
			Text: string(hclwrite.Format(blk.BuildTokens(nil).Bytes()))}))
		nf, d := hclwrite.ParseConfig([]byte(v), "v.tf", hcl.InitialPos)
		if d.HasErrors() || len(nf.Body().Blocks()) != 1 {
			continue
		}
		if a := nf.Body().Blocks()[0].Body().GetAttribute("default"); a != nil {
			blk.Body().SetAttributeRaw("default", a.Expr().BuildTokens(nil))
			changed = true
		}
	}
	if !changed {
		return text
	}
	return string(f.Bytes())
}

// variable: a required variable, its default the prototype's value.
func (p *Payload) variable(r Requirement) string {
	v, ok := p.VariableValues[r.Name]
	if !ok {
		return r.Text
	}
	f, diags := hclwrite.ParseConfig([]byte(r.Text), "v.tf", hcl.InitialPos)
	if diags.HasErrors() || len(f.Body().Blocks()) != 1 {
		return r.Text
	}
	blk := f.Body().Blocks()[0]
	switch r.Type {
	case "bool":
		blk.Body().SetAttributeRaw("default", hclwrite.Tokens{{Type: hclsyntax.TokenIdent, Bytes: []byte(strconv.FormatBool(v == "true"))}})
	case "number":
		if _, err := strconv.ParseFloat(v, 64); err == nil {
			blk.Body().SetAttributeRaw("default", hclwrite.Tokens{{Type: hclsyntax.TokenNumberLit, Bytes: []byte(v)}})
		}
	case "string", "":
		blk.Body().SetAttributeValue("default", cty.StringVal(v))
	}
	return strings.TrimSpace(string(f.Bytes()))
}

// ---------------------------------------------------------------------------------------------------- archives

// DecorateArchive is Decorate on a template version's tar: the same tar when
// nothing is injected.
func (p *Payload) DecorateArchive(archive []byte) ([]byte, *Result, error) {
	type entry struct {
		hdr  *tar.Header
		data []byte
	}
	var entries []entry
	files := map[string][]byte{}
	tr := tar.NewReader(bytes.NewReader(archive))
	for {
		hdr, err := tr.Next()
		if xerrors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, nil, xerrors.Errorf("read the template's archive: %w", err)
		}
		var data []byte
		if hdr.Typeflag == tar.TypeReg {
			data, err = io.ReadAll(io.LimitReader(tr, maxFile+1))
			if err != nil {
				return nil, nil, err
			}
			if len(data) > maxFile {
				return archive, &Result{}, nil // a file too large to read: left as it is
			}
			name := path.Clean(strings.TrimPrefix(hdr.Name, "./"))
			files[name] = data
		}
		entries = append(entries, entry{hdr: hdr, data: data})
	}
	res, err := p.Decorate(files)
	if err != nil {
		return nil, nil, err
	}
	if len(res.Injected) == 0 {
		return archive, res, nil
	}
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	written := map[string]bool{}
	for _, e := range entries {
		hdr := *e.hdr
		data := e.data
		if hdr.Typeflag == tar.TypeReg {
			name := path.Clean(strings.TrimPrefix(hdr.Name, "./"))
			data = res.Files[name]
			hdr.Size = int64(len(data))
			written[name] = true
		}
		if err := tw.WriteHeader(&hdr); err != nil {
			return nil, nil, err
		}
		if hdr.Typeflag == tar.TypeReg {
			if _, err := tw.Write(data); err != nil {
				return nil, nil, err
			}
		}
	}
	if len(res.Added) > 0 {
		if err := tw.WriteHeader(&tar.Header{Name: ScriptDir + "/", Typeflag: tar.TypeDir, Mode: 0o755, ModTime: time.Unix(0, 0)}); err != nil {
			return nil, nil, err
		}
	}
	for _, name := range res.Added {
		if written[name] {
			continue
		}
		data := res.Files[name]
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(data)), ModTime: time.Unix(0, 0)}); err != nil {
			return nil, nil, err
		}
		if _, err := tw.Write(data); err != nil {
			return nil, nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, nil, err
	}
	return buf.Bytes(), res, nil
}

// String describes a result for the logs.
func (r *Result) String() string {
	skipped := make([]string, len(r.Skipped))
	for i, s := range r.Skipped {
		skipped[i] = fmt.Sprintf("%s (%s)", s.Feature, s.Reason)
	}
	return fmt.Sprintf("injected %v, skipped %v", r.Injected, skipped)
}

// Reference is how a template uses one of the files the decorator provides: the
// prototype's own use of it, as it reads in a decorated template.
type Reference struct {
	// Text: the attribute that reads it ("script = templatefile(...)").
	Text string
	// Features whose sections read it.
	Features []string
}

// References: for each file the payload provides, the first place a section
// reads it, rewritten to ScriptDir.
func (p *Payload) References() map[string]Reference {
	out := map[string]Reference{}
	for _, s := range p.Sections {
		f, diags := hclsyntax.ParseConfig([]byte(s.Text), s.Feature+".tf", hcl.InitialPos)
		if diags.HasErrors() {
			continue
		}
		src := []byte(s.Text)
		_ = hclsyntax.VisitAll(f.Body.(*hclsyntax.Body), func(n hclsyntax.Node) hcl.Diagnostics {
			a, ok := n.(*hclsyntax.Attribute)
			if !ok {
				return nil
			}
			text := string(a.SrcRange.SliceBytes(src))
			for _, m := range scriptRef.FindAllStringSubmatch(text, -1) {
				ref := out[m[1]]
				if ref.Text == "" {
					ref.Text = string(hclwrite.Format([]byte(strings.ReplaceAll(text, "${path.module}/scripts/",
						"${path.module}/"+ScriptDir+"/"))))
				}
				if !contains(ref.Features, s.Feature) {
					ref.Features = append(ref.Features, s.Feature)
				}
				out[m[1]] = ref
			}
			return nil
		})
	}
	return out
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
