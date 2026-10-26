package medialease

import (
	"context"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestReplicaFenceNeverRevivesOldMedia(t *testing.T) {
	t.Parallel()
	fence := NewFence()
	require.ErrorIs(t, fence.Context().Err(), context.Canceled)
	fence.SetServing(true)
	first := fence.Context()
	require.NoError(t, first.Err())
	fence.SetServing(false)
	require.ErrorIs(t, first.Err(), context.Canceled)
	fence.SetServing(true)
	require.NoError(t, fence.Context().Err())
	require.ErrorIs(t, first.Err(), context.Canceled)
	fence.SetServing(false)
}
