# Historical guard reconciliation for the live Pages baseline

The immutable Pages deployment `d0acd4af-738d-4dee-9f4b-5df4612bd4b0` serves the static bytes captured in commit `49193864009781343441d0343700407b0293370f`. That deployment includes reviewed content, phone, asset, and backend changes made after the older feature releases below. Those releases remain useful evidence, but their tests must not claim that the current site still differs from an old parent by only the original patch. The live-site baseline guard now protects the current public build and runtime files; these tests continue to prove the historical releases and specific functionality. No test was skipped or deleted.

The following 18 stale assertions were reconciled individually:

1. `asset-delivery`: The old versioned `script.8c...js` digest no longer matched because production serves the later `488...` bytes at that legacy URL. The test explicitly verifies the alias and the other registered digests.
2. `asset-delivery`: A whole-repository comparison against the original asset-migration parent rejected later releases. The test now proves that the captured static release left backend bytes unchanged from its production source commit, while the new live-site guard checks current backend changes.
3. `asset-delivery`: An exact `_headers` transformation from the asset-migration parent omitted two later script generations. The test now checks caching and indexing policy for every served generation; the new live-site guard checks exact current bytes.
4. `city-market-exact-copy`: A global comparison to the old city-copy parent rejected later site releases. The test now audits the historical city-copy release `4a4a40e` against its parent; the other city-copy tests still check all 4,674 approved changes and FAQ parity in current pages.
5. `four-guide-ai-authority-cluster`: Protected page and operational hashes represented different approved dates. Current protected pages are checked against their live reviewed hashes, while earlier operational hashes are checked at their original commits and the captured static release is proved not to have changed the production-source operations.
6. `homepage-cleanup`: Reversing seven copy nodes from today's homepage could not reproduce an old page after later asset changes. The same reversal is now proved against the immutable homepage release `4c412cb`.
7. `homepage-cleanup`: A whole-repository equality assertion to the pre-homepage release rejected later approved content. It now checks that `4c412cb` changed only its approved files.
8. `homepage-cleanup`: Exact hashes for four adapted tests were for `4c412cb`, not today's adaptations. The test verifies those historical hashes and ensures current versions retain their test counts without skips.
9. `modal-focus`: The modal release's global source comparison rejected later Pages changes. It now audits immutable modal release `0ebc4ec` against its parent.
10. `modal-focus`: A diff of the active script against the pre-modal script included later phone-display changes. The analytics and submission isolation proof now compares the scripts from the original modal release.
11. `pages-deployment-hardening`: The explicit public allowlist lacked the two script generations that production now serves. Both names were added; internal files remain excluded.
12. `pest-guide-exact-copy`: A whole-repository check to the pest-guide preview parent rejected later releases. It now audits immutable pest-guide release `e6fa694`; current copy, schema, CTA, and link tests remain active.
13. `protected-guide-header`: Current pages load a later script, so the original two-reference release could not compare raw page slices to its old parent. The historical markup proof now uses immutable header release `6295efb`.
14. `protected-guide-header`: A global diff and manifest expectation from `6295efb` improperly included later modal and phone assets. It now checks that original release against its parent, with current assets independently checked by the live guard.
15. `protected-guide-header`: Old versioned assets were overwritten or supplemented after `6295efb`. Parent and rollback byte checks now use the immutable header release rather than current aliases.
16. `release-synchronization`: The frozen broker patch's whole-repository comparison did not allow later content work. It now proves the reviewed broker release at `706c069` while retaining the original four-file live patch check.
17. `release-synchronization`: Operational hashes pinned at the synchronization release were compared to later live files. They are now verified at their reviewed commits (`ed94cc5`, or `204f5b7` for the subsequent intake test).
18. `release-synchronization`: A global allowlist for the broker release rejected later website changes. It now compares the immutable broker release `706c069` against its original baseline `ed94cc5`.

Future releases should update the live-site review manifest for each intentional public or runtime change; these historical proofs should remain tied to their original commits.
