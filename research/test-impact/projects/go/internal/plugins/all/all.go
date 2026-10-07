// Package all links every fee plugin into the binary.
package all

import (
	_ "shop/internal/plugins/ecofee"
	_ "shop/internal/plugins/servicefee"
)
