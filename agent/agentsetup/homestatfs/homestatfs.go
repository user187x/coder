// Package homestatfs holds the library that makes btop show the workspace's
// home volume instead of the node's whole disk. See home-statfs.c.
package homestatfs

// Library is the preloadable library for this architecture, or nil where
// there is none.
func Library() []byte { return library }
