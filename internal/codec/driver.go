package codec

import (
	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

var driverNames = map[gocql.Type]string{
	gocql.TypeAscii: "ascii", gocql.TypeBigInt: "bigint", gocql.TypeBlob: "blob", gocql.TypeBoolean: "boolean",
	gocql.TypeCounter: "counter", gocql.TypeDecimal: "decimal", gocql.TypeDouble: "double", gocql.TypeFloat: "float",
	gocql.TypeInt: "int", gocql.TypeText: "text", gocql.TypeTimestamp: "timestamp", gocql.TypeUUID: "uuid",
	gocql.TypeVarchar: "varchar", gocql.TypeVarint: "varint", gocql.TypeTimeUUID: "timeuuid", gocql.TypeInet: "inet",
	gocql.TypeDate: "date", gocql.TypeTime: "time", gocql.TypeSmallInt: "smallint", gocql.TypeTinyInt: "tinyint",
	gocql.TypeDuration: "duration",
}

// FromDriver derives a descriptor from a driver result-column type. It cannot
// know frozen-ness; callers prefer the schema snapshot when they have it.
func FromDriver(ti gocql.TypeInfo) TypeDesc {
	switch t := ti.(type) {
	case gocql.CollectionType:
		switch t.Type() {
		case gocql.TypeMap:
			return TypeDesc{Name: "map", Args: []TypeDesc{FromDriver(t.Key), FromDriver(t.Elem)}}
		case gocql.TypeSet:
			return TypeDesc{Name: "set", Args: []TypeDesc{FromDriver(t.Elem)}}
		default:
			return TypeDesc{Name: "list", Args: []TypeDesc{FromDriver(t.Elem)}}
		}
	case gocql.TupleTypeInfo:
		d := TypeDesc{Name: "tuple"}
		for _, e := range t.Elems {
			d.Args = append(d.Args, FromDriver(e))
		}
		return d
	case gocql.UDTTypeInfo:
		return TypeDesc{Name: t.Name, UDT: &UDTRef{Keyspace: t.Keyspace, Name: t.Name}}
	case gocql.VectorType:
		return TypeDesc{Name: "vector", Args: []TypeDesc{FromDriver(t.SubType)}, Size: t.Dimensions}
	}
	if n, ok := driverNames[ti.Type()]; ok {
		return TypeDesc{Name: n}
	}
	return TypeDesc{Name: "text"}
}
