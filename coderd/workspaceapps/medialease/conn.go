package medialease

import (
	"net"
	"net/netip"
	"sync"

	"github.com/pion/stun/v3"
	"golang.org/x/time/rate"
)

// TURN permissions cover an IP, not its ports. This socket additionally fences
// every datagram to the one reviewed workspace ICE endpoint in both directions.
type filteredConn struct {
	net.PacketConn
	lease     *Lease
	peer      bool
	closeOnce sync.Once
	closeErr  error
}

func (c *filteredConn) Close() error {
	c.closeOnce.Do(func() { c.closeErr = c.PacketConn.Close() })
	return c.closeErr
}

func newFilteredConn(conn *net.UDPConn, l *Lease, peer bool) (*filteredConn, error) {
	if err := conn.SetReadBuffer(64 * 1024); err != nil {
		return nil, err
	}
	if err := conn.SetWriteBuffer(64 * 1024); err != nil {
		return nil, err
	}
	return &filteredConn{PacketConn: conn, lease: l, peer: peer}, nil
}

func udpEndpoint(addr net.Addr) (netip.AddrPort, bool) {
	udp, ok := addr.(*net.UDPAddr)
	if !ok {
		return netip.AddrPort{}, false
	}
	endpoint := udp.AddrPort()
	return netip.AddrPortFrom(endpoint.Addr().Unmap(), endpoint.Port()), true
}

func (c *filteredConn) allowed(addr net.Addr) bool {
	endpoint, ok := udpEndpoint(addr)
	if !ok {
		return false
	}
	if c.peer {
		return endpoint == c.lease.binding.Peer
	}
	return c.lease.client(addr)
}

func (c *filteredConn) ReadFrom(buffer []byte) (int, net.Addr, error) {
	for {
		n, addr, err := c.PacketConn.ReadFrom(buffer)
		if err != nil {
			return n, addr, err
		}
		if !c.lease.active() {
			return 0, nil, net.ErrClosed
		}
		if c.allowed(addr) && c.lease.limiter.Allow() && (c.peer || c.peerAttributesAllowed(buffer[:n])) {
			return n, addr, nil
		}
	}
}

func (c *filteredConn) peerAttributesAllowed(packet []byte) bool {
	if !stun.IsMessage(packet) {
		// Channel data uses only previously admitted channel bindings.
		return true
	}
	message := &stun.Message{Raw: packet}
	if err := message.Decode(); err != nil {
		return false
	}
	err := message.ForEach(stun.AttrXORPeerAddress, func(message *stun.Message) error {
		var peer stun.XORMappedAddress
		if err := peer.GetFromAs(message, stun.AttrXORPeerAddress); err != nil {
			return err
		}
		ip, ok := netip.AddrFromSlice(peer.IP)
		if !ok || ip.Unmap() != c.lease.binding.Peer.Addr() || peer.Port != int(c.lease.binding.Peer.Port()) {
			return errDatagramDenied
		}
		return nil
	})
	return err == nil
}

func (c *filteredConn) WriteTo(buffer []byte, addr net.Addr) (int, error) {
	if !c.lease.active() {
		return 0, net.ErrClosed
	}
	if len(buffer) > 1500 || !c.allowed(addr) || !c.lease.limiter.Allow() {
		return 0, errDatagramDenied
	}
	return c.PacketConn.WriteTo(buffer, addr)
}

func newLimiter(packetsPerSecond int) *rate.Limiter {
	return rate.NewLimiter(rate.Limit(packetsPerSecond), 64)
}
