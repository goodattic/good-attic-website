# Observed ad location IDs

The table shows every ID in the user-provided `observed_utm_location_examples` list and the town the preview landing pages will show. “Yes” means the market fallback is shown.

| Market | ID | Google target type | Town shown | Fallback? |
| --- | --- | --- | --- | --- |
| Utah | 9029705 | Postal Code | Lehi | No |
| Utah | 9029707 | Postal Code | Saratoga Springs | No |
| Utah | 9029721 | Postal Code | Pleasant Grove | No |
| Utah | 9029766 | Postal Code | South Salt Lake | No |
| Utah | 9029749 | Postal Code | South Jordan | No |
| Utah | 9029751 | Postal Code | Orem | No |
| Utah | 9029771 | Postal Code | West Valley City | No |
| Utah | 9029676 | Postal Code | Utah | Yes |
| Utah | 9029774 | Postal Code | Taylorsville | No |
| Utah | 9029776 | Postal Code | West Valley City | No |
| Utah | 9051856 | City | Eagle Mountain | No |
| Utah | 9053130 | City | West Valley City | No |
| Utah | 9052124 | City | Herriman | No |
| Utah | 9052441 | City | Millcreek | No |
| Utah | 1026991 | City | Sandy | No |
| Utah | 9051778 | City | Cottonwood Heights | No |
| Utah | 1026953 | City | Magna | No |
| Utah | 1026989 | City | Salem | No |
| Utah | 9195189 | Neighborhood | Utah | Yes |
| Utah | 9191829 | Neighborhood | Utah | Yes |
| Utah | 9223606 | City | Oakley | No |
| Utah | 9196758 | Postal Code | South Jordan | No |
| Utah | 9197915 | Neighborhood | Utah | Yes |
| Utah | 9210838 | City | Utah | Yes |
| St. Louis | 9022936 | Postal Code | St. Peters | No |
| St. Louis | 9022896 | Postal Code | Creve Coeur | No |
| St. Louis | 9022817 | Postal Code | Fenton | No |
| St. Louis | 9022865 | Postal Code | St. Louis area | Yes |
| St. Louis | 9022885 | Postal Code | University City | No |
| St. Louis | 9022880 | Postal Code | Mehlville | No |
| St. Louis | 9022905 | Postal Code | St. Charles | No |
| St. Louis | 9022906 | Postal Code | Weldon Spring | No |
| St. Louis | 9022825 | Postal Code | Wildwood | No |
| St. Louis | 9022821 | Postal Code | Florissant | No |
| St. Louis | 9022877 | Postal Code | Kirkwood | No |
| St. Louis | 9022878 | Postal Code | Affton | No |
| St. Louis | 9022883 | Postal Code | Concord | No |
| St. Louis | 9010255 | Postal Code | St. Louis area | Yes |
| St. Louis | 1020613 | City | St. Charles | No |
| St. Louis | 1020618 | City | St. Louis area | Yes |
| St. Louis | 1020519 | City | O'Fallon | No |
| St. Louis | 1020183 | City | Ballwin | No |
| St. Louis | 1020256 | City | Chesterfield | No |
| St. Louis | 9052587 | City | Oakville | No |
| St. Louis | 9052946 | City | Sunset Hills | No |
| St. Louis | 9052894 | City | Spanish Lake | No |
| St. Louis | 9195515 | City | Sappington | No |
| St. Louis | 9192802 | Neighborhood | St. Louis area | Yes |
| Kansas City | 9023170 | Postal Code | Grain Valley | No |
| Kansas City | 9023209 | Postal Code | Lee's Summit | No |
| Kansas City | 9023242 | Postal Code | Kansas City | No |
| Kansas City | 9023247 | Postal Code | Kansas City | No |
| Kansas City | 9023221 | Postal Code | Kansas City | No |
| Kansas City | 9023179 | Postal Code | Independence | No |
| Kansas City | 9023158 | Postal Code | Kansas City area | Yes |
| Kansas City | 9023257 | Postal Code | Kansas City | No |
| Kansas City | 9023193 | Postal Code | Liberty | No |
| Kansas City | 9023911 | Postal Code | Shawnee | No |
| Kansas City | 9023918 | Postal Code | Shawnee | No |
| Kansas City | 9023900 | Postal Code | Leawood | No |
| Kansas City | 9023858 | Postal Code | Olathe | No |
| Kansas City | 9023859 | Postal Code | Olathe | No |
| Kansas City | 9023913 | Postal Code | Lenexa | No |
| Kansas City | 9023898 | Postal Code | Overland Park | No |
| Kansas City | 1020414 | City | Kansas City | No |
| Kansas City | 1017596 | City | Overland Park | No |
| Kansas City | 1017631 | City | Shawnee | No |
| Kansas City | 1017542 | City | Lenexa | No |
| Kansas City | 1017477 | City | Fort Leavenworth | No |
| Kansas City | 1017538 | City | Leavenworth | No |
| Kansas City | 9052025 | City | Gladstone | No |
| Kansas City | 9052423 | City | Merriam | No |
| Kansas City | 9192235 | Neighborhood | Kansas City area | Yes |
| Kansas City | 9198121 | Neighborhood | Kansas City area | Yes |
| Kansas City | 9197872 | Neighborhood | Kansas City area | Yes |
| Kansas City | 9192575 | Neighborhood | Kansas City area | Yes |
| Kansas City | 9189421 | Neighborhood | Kansas City area | Yes |

Fallback IDs: Utah 9029676, Utah 9195189, Utah 9191829, Utah 9197915, Utah 9210838, St. Louis 9022865, St. Louis 9010255, St. Louis 1020618, St. Louis 9192802, Kansas City 9023158, Kansas City 9192235, Kansas City 9198121, Kansas City 9197872, Kansas City 9192575, Kansas City 9189421.

Sources: [Google Ads geo targets (2026-08-12)](https://developers.google.com/google-ads/api/data/geotargets), [Census 2020 ZCTA–county and ZCTA–place relationships](https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.2020.html), [Census place-by-county codes](https://www2.census.gov/geo/docs/reference/codes2020/), [GeoNames postal-code data](https://www.geonames.org/export/zip/), and `data/ad-target-towns.json` copied from the supplied town list. A ZIP can cross town or county boundaries; its one displayed town cannot identify an individual home.
