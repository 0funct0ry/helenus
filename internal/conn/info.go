package conn

import (
	"context"
	"fmt"
	"net"
	"sort"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// Node is one cluster member.
type Node struct {
	Address string `json:"address"`
	DC      string `json:"dc"`
	Rack    string `json:"rack"`
	Version string `json:"version"`
	HostID  string `json:"host_id"`
}

// ClusterInfo summarizes the cluster behind a session (banner, /cluster, test).
type ClusterInfo struct {
	Name            string   `json:"name"`
	ReleaseVersion  string   `json:"release_version"`
	CQLVersion      string   `json:"cql_version"`
	ProtocolVersion string   `json:"protocol_version"`
	LocalDC         string   `json:"local_dc"`
	Datacenters     []string `json:"datacenters"`
	Nodes           []Node   `json:"nodes"`
	NodeCount       int      `json:"node_count"`
	Keyspace        string   `json:"keyspace,omitempty"`
}

// Info reads cluster details from system.local and the peers tables.
func Info(ctx context.Context, s *gocql.Session) (*ClusterInfo, error) {
	var (
		info            ClusterInfo
		dc, rack, proto string
		hostID          gocql.UUID
		addr            net.IP
	)
	err := s.Query(`SELECT cluster_name, release_version, cql_version, data_center, rack, host_id, rpc_address FROM system.local`).
		ScanContext(ctx, &info.Name, &info.ReleaseVersion, &info.CQLVersion, &dc, &rack, &hostID, &addr)
	if err != nil {
		return nil, fmt.Errorf("reading system.local: %w", err)
	}
	// Absent on some versions; the value is informational only.
	_ = s.Query(`SELECT native_protocol_version FROM system.local`).ScanContext(ctx, &proto)
	info.ProtocolVersion = proto
	info.LocalDC = dc
	info.Nodes = append(info.Nodes, Node{Address: addr.String(), DC: dc, Rack: rack, Version: info.ReleaseVersion, HostID: hostID.String()})

	peers, err := readPeers(ctx, s, `SELECT peer, data_center, rack, release_version, host_id FROM system.peers_v2`)
	if err != nil {
		peers, err = readPeers(ctx, s, `SELECT peer, data_center, rack, release_version, host_id FROM system.peers`)
		if err != nil {
			return nil, fmt.Errorf("reading peers: %w", err)
		}
	}
	info.Nodes = append(info.Nodes, peers...)
	seen := map[string]bool{}
	for _, n := range info.Nodes {
		if n.DC != "" && !seen[n.DC] {
			seen[n.DC] = true
			info.Datacenters = append(info.Datacenters, n.DC)
		}
	}
	sort.Strings(info.Datacenters)
	info.NodeCount = len(info.Nodes)
	return &info, nil
}

func readPeers(ctx context.Context, s *gocql.Session, stmt string) ([]Node, error) {
	iter := s.Query(stmt).IterContext(ctx)
	var (
		out           []Node
		peer          net.IP
		dc, rack, ver string
		hostID        gocql.UUID
	)
	for iter.Scan(&peer, &dc, &rack, &ver, &hostID) {
		out = append(out, Node{Address: peer.String(), DC: dc, Rack: rack, Version: ver, HostID: hostID.String()})
	}
	if err := iter.Close(); err != nil {
		return nil, err
	}
	return out, nil
}
