# Live production versus hosted preview: mobile LP headline

Measured with headless Chrome against `https://goodattic.energy` and the hosted preview `https://2afdd83b.good-attic-website.pages.dev`. Where needed, the requested town replaced only the `[data-lp-town]` HTML span in the browser response before parsing; normal live/preview styles and scripts then ran. Google analytics and images were blocked. No form, call, text, or production write occurred.

The table gives the first form submit button’s lower edge relative to viewport top. All 52 hosted preview font sizes, line counts, and button bottoms matched live exactly. The largest submit bottom was 612.1px in a 360×640 viewport. A separate local build run of the byte-identical preview recorded zero layout shifts in all 52 cases; headline font at `DOMContentLoaded` matched its settled font in all cases.

| Page type | Viewport | Town shown | Live font | Preview font | Lines live / preview | Submit bottom live / preview |
|---|---:|---|---:|---:|---:|---:|
| attic-insulation | 360×640 | Lehi | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 360×640 | Draper | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 360×640 | Salt Lake City | 31.5px | 31.5px | 3 / 3 | 583.9px / 583.9px |
| attic-insulation | 360×640 | Cottonwood Heights | 28px | 28px | 3 / 3 | 572.9px / 572.9px |
| attic-insulation | 360×640 | West Valley City | 31.5px | 31.5px | 3 / 3 | 583.9px / 583.9px |
| attic-insulation | 360×640 | Saratoga Springs | 28px | 28px | 3 / 3 | 572.9px / 572.9px |
| attic-insulation | 360×640 | Town and Country | 28px | 28px | 3 / 3 | 572.9px / 572.9px |
| attic-insulation | 360×640 | Dardenne Prairie | 28.5px | 28.5px | 3 / 3 | 574.5px / 574.5px |
| attic-insulation | 360×640 | North Kansas City | 29px | 29px | 3 / 3 | 594.2px / 594.2px |
| attic-insulation | 360×640 | Prairie Village | 29px | 29px | 3 / 3 | 594.2px / 594.2px |
| attic-insulation | 360×640 | Utah | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 360×640 | St. Louis area | 31px | 31px | 3 / 3 | 582.4px / 582.4px |
| attic-insulation | 360×640 | Kansas City area | 31px | 31px | 3 / 3 | 600.6px / 600.6px |
| attic-insulation | 375×667 | Lehi | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 375×667 | Draper | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 375×667 | Salt Lake City | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 375×667 | Cottonwood Heights | 29px | 29px | 3 / 3 | 576.1px / 576.1px |
| attic-insulation | 375×667 | West Valley City | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 375×667 | Saratoga Springs | 29px | 29px | 3 / 3 | 576.1px / 576.1px |
| attic-insulation | 375×667 | Town and Country | 29px | 29px | 3 / 3 | 576.1px / 576.1px |
| attic-insulation | 375×667 | Dardenne Prairie | 30px | 30px | 3 / 3 | 579.2px / 579.2px |
| attic-insulation | 375×667 | North Kansas City | 30.5px | 30.5px | 3 / 3 | 599.0px / 599.0px |
| attic-insulation | 375×667 | Prairie Village | 30px | 30px | 3 / 3 | 597.4px / 597.4px |
| attic-insulation | 375×667 | Utah | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 375×667 | St. Louis area | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| attic-insulation | 375×667 | Kansas City area | 32px | 32px | 3 / 3 | 603.7px / 603.7px |
| insulation-removal | 360×640 | Lehi | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| insulation-removal | 360×640 | Draper | 30px | 30px | 3 / 3 | 579.2px / 579.2px |
| insulation-removal | 360×640 | Salt Lake City | 26.5px | 26.5px | 3 / 3 | 568.2px / 568.2px |
| insulation-removal | 360×640 | Cottonwood Heights | 26px | 26px | 4 / 4 | 593.9px / 593.9px |
| insulation-removal | 360×640 | West Valley City | 26px | 26px | 4 / 4 | 593.9px / 593.9px |
| insulation-removal | 360×640 | Saratoga Springs | 26px | 26px | 4 / 4 | 593.9px / 593.9px |
| insulation-removal | 360×640 | Town and Country | 26px | 26px | 4 / 4 | 593.9px / 593.9px |
| insulation-removal | 360×640 | Dardenne Prairie | 26px | 26px | 4 / 4 | 593.9px / 593.9px |
| insulation-removal | 360×640 | North Kansas City | 26px | 26px | 4 / 4 | 612.1px / 612.1px |
| insulation-removal | 360×640 | Prairie Village | 26.5px | 26.5px | 3 / 3 | 586.4px / 586.4px |
| insulation-removal | 360×640 | Utah | 32px | 32px | 3 / 3 | 585.5px / 585.5px |
| insulation-removal | 360×640 | St. Louis area | 27px | 27px | 3 / 3 | 569.8px / 569.8px |
| insulation-removal | 360×640 | Kansas City area | 26px | 26px | 4 / 4 | 612.1px / 612.1px |
| insulation-removal | 375×667 | Lehi | 32px | 32px | 3 / 3 | 563.9px / 563.9px |
| insulation-removal | 375×667 | Draper | 31.5px | 31.5px | 3 / 3 | 562.3px / 562.3px |
| insulation-removal | 375×667 | Salt Lake City | 28px | 28px | 3 / 3 | 551.3px / 551.3px |
| insulation-removal | 375×667 | Cottonwood Heights | 26px | 26px | 4 / 4 | 572.3px / 572.3px |
| insulation-removal | 375×667 | West Valley City | 26px | 26px | 4 / 4 | 572.3px / 572.3px |
| insulation-removal | 375×667 | Saratoga Springs | 26px | 26px | 4 / 4 | 572.3px / 572.3px |
| insulation-removal | 375×667 | Town and Country | 26px | 26px | 4 / 4 | 572.3px / 572.3px |
| insulation-removal | 375×667 | Dardenne Prairie | 26px | 26px | 4 / 4 | 572.3px / 572.3px |
| insulation-removal | 375×667 | North Kansas City | 26px | 26px | 4 / 4 | 590.5px / 590.5px |
| insulation-removal | 375×667 | Prairie Village | 27.5px | 27.5px | 3 / 3 | 568.0px / 568.0px |
| insulation-removal | 375×667 | Utah | 32px | 32px | 3 / 3 | 563.9px / 563.9px |
| insulation-removal | 375×667 | St. Louis area | 28px | 28px | 3 / 3 | 551.3px / 551.3px |
| insulation-removal | 375×667 | Kansas City area | 26px | 26px | 4 / 4 | 590.5px / 590.5px |
