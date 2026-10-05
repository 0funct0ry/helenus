package export

import "encoding/base64"

func decodePageState(s string) ([]byte, error) { return base64.StdEncoding.DecodeString(s) }
