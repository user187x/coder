package homestatfs_test

import (
	"bytes"
	"debug/elf"
	"runtime"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agentsetup/homestatfs"
)

// The embedded library must be this architecture's, export the functions
// btop calls, and need nothing but the C library's getenv and errno.
func TestLibrary(t *testing.T) {
	t.Parallel()
	machine := map[string]elf.Machine{"amd64": elf.EM_X86_64, "arm64": elf.EM_AARCH64}[runtime.GOARCH]
	if runtime.GOOS != "linux" || machine == elf.EM_NONE {
		require.Empty(t, homestatfs.Library())
		return
	}
	lib, err := elf.NewFile(bytes.NewReader(homestatfs.Library()))
	require.NoError(t, err)
	require.Equal(t, machine, lib.Machine)
	require.Equal(t, elf.ET_DYN, lib.Type)
	symbols, err := lib.DynamicSymbols()
	require.NoError(t, err)
	var defined, undefined []string
	for _, symbol := range symbols {
		if symbol.Section == elf.SHN_UNDEF {
			undefined = append(undefined, symbol.Name)
		} else if elf.ST_BIND(symbol.Info) == elf.STB_GLOBAL {
			defined = append(defined, symbol.Name)
		}
	}
	slices.Sort(defined)
	slices.Sort(undefined)
	require.Equal(t, []string{"statfs", "statfs64", "statvfs", "statvfs64"}, defined)
	require.Equal(t, []string{"__errno_location", "getenv"}, undefined)
}
