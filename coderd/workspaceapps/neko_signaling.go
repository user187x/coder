package workspaceapps

import (
	"encoding/json"
	"errors"
	"net/netip"
	"strconv"
	"strings"

	"github.com/coder/coder/v2/coderd/workspaceapps/medialease"
)

func rewriteNekoSignal(raw []byte, credentials medialease.Credentials, relay, peer netip.AddrPort, toBrowser bool) ([]byte, bool, error) {
	if len(raw) > 128*1024 {
		return nil, false, errors.New("neko signaling exceeds its bound")
	}
	var message map[string]json.RawMessage
	if err := json.Unmarshal(raw, &message); err != nil {
		return nil, false, err
	}
	var event string
	if err := json.Unmarshal(message["event"], &event); err != nil || event == "" {
		return nil, false, errors.New("neko event is invalid")
	}
	if !strings.HasPrefix(event, "signal/") {
		return raw, true, nil
	}
	expected, kind := relay, "relay"
	if toBrowser {
		expected, kind = peer, "host"
	}
	switch event {
	case "signal/provide":
		if !toBrowser {
			return nil, false, errors.New("browser cannot provide Neko server configuration")
		}
		ice, err := json.Marshal([]map[string]any{{"urls": []string{credentials.URL}, "username": credentials.Username, "credential": credentials.Password}})
		if err != nil {
			return nil, false, err
		}
		message["ice"] = ice
		message["lite"] = json.RawMessage("false")
		fallthrough
	case "signal/offer", "signal/answer":
		var sdp string
		if err := json.Unmarshal(message["sdp"], &sdp); err != nil {
			return nil, false, err
		}
		clean, err := filterNekoSDP(sdp, expected, kind)
		if err != nil {
			return nil, false, err
		}
		message["sdp"], _ = json.Marshal(clean)
	case "signal/candidate":
		var encoded string
		if err := json.Unmarshal(message["data"], &encoded); err != nil {
			return nil, false, err
		}
		var candidate struct {
			Candidate        string  `json:"candidate"`
			SDPMid           *string `json:"sdpMid"`
			SDPMLineIndex    *uint16 `json:"sdpMLineIndex"`
			UsernameFragment *string `json:"usernameFragment"`
		}
		if err := json.Unmarshal([]byte(encoded), &candidate); err != nil {
			return nil, false, err
		}
		if !nekoCandidate(candidate.Candidate, expected, kind) {
			return nil, false, nil
		}
	default:
		return nil, false, errors.New("unsupported Neko signaling event")
	}
	updated, err := json.Marshal(message)
	return updated, true, err
}

func nekoCandidate(candidate string, expected netip.AddrPort, kind string) bool {
	fields := strings.Fields(strings.TrimPrefix(candidate, "a="))
	if len(fields) < 8 || !strings.HasPrefix(fields[0], "candidate:") || fields[1] != "1" || !strings.EqualFold(fields[2], "udp") || fields[6] != "typ" || fields[7] != kind {
		return false
	}
	ip, err := netip.ParseAddr(fields[4])
	if err != nil || ip.Unmap() != expected.Addr() {
		return false
	}
	port, err := strconv.ParseUint(fields[5], 10, 16)
	return err == nil && uint16(port) == expected.Port()
}

func filterNekoSDP(sdp string, expected netip.AddrPort, kind string) (string, error) {
	if len(sdp) > 96*1024 || !strings.HasPrefix(sdp, "v=0") {
		return "", errors.New("neko SDP is invalid")
	}
	lines := strings.Split(strings.ReplaceAll(sdp, "\r\n", "\n"), "\n")
	output := make([]string, 0, len(lines))
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "a=candidate:"):
			if !nekoCandidate(line, expected, kind) {
				continue
			}
		case strings.HasPrefix(line, "a=remote-candidates:"), strings.HasPrefix(line, "a=rtcp:"):
			continue
		case strings.HasPrefix(line, "c="):
			line = "c=IN IP4 0.0.0.0"
		case strings.HasPrefix(line, "m="):
			fields := strings.Fields(line)
			if len(fields) < 4 {
				return "", errors.New("neko SDP media line is invalid")
			}
			if fields[1] != "0" {
				fields[1] = "9"
			}
			line = strings.Join(fields, " ")
		}
		output = append(output, line)
	}
	return strings.Join(output, "\r\n"), nil
}
