# Site 1: arXiv (arxiv.org/html/2605.06716v1)

## Structure Comparison
- **MD headings**: 30 (H1-H3)
- **Web headings**: 30 (H1-H3)  
- **Match**: ✅ SAME COUNT, all 8 sampled headings match exactly
- **Order**: ✅ Correct (1→2→2.1→2.2→3→3.1→...→Appendix D)

## Tables
- **Web**: 3 tables (Table 1: 5 rows, Table 2: 15 rows, Table 3: 20 rows)
- **MD**: 3 tables extracted via marker-based preservation
- **Position**: ✅ Markers placed at original DOM positions
- **Format**: ⚠️ CDN GFM plugin format mismatch; built extension has properly bundled GFM

## Issues Found
1. GFM plugin CDN export differs from npm import — CDN test shows plain text, built version works
2. Need to verify built extension produces `|` formatted tables at correct inline positions

## Status
🟡 CDN test limitation — needs built extension verification
