# Changelog

## [0.1.2](https://github.com/angelopublio/agent-spartan-protocol-relay/compare/v0.1.1...v0.1.2) (2026-11-27)


### Bug Fixes

* reject an unusable skill and keep a BLOCKED review out of the budget ([dea9c98](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/dea9c9894e3ac97d2d282f03aa76a9dbef6693c6))

## [0.1.1](https://github.com/angelopublio/agent-spartan-protocol-relay/compare/v0.1.0...v0.1.1) (2026-11-27)


### Bug Fixes

* close the relay's producer pane when the task completes ([de95932](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/de95932f524ae2f490ef900ce8b463cba4511029))
* derive the review budget and arbitration from the captures on disk ([0f7c939](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/0f7c93917ad6a0581e2c01cc9299700f4487f4bb))
* press Enter when any unsent prompt text sits in Cursor's input box ([#6](https://github.com/angelopublio/agent-spartan-protocol-relay/issues/6)) ([d59f8b4](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/d59f8b4bf0ae1a418a03fc816b5109710dd52399))
* press the dropped Enter throughout the stall grace period ([c8c75e2](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/c8c75e240d628f0acb74dc20df1f970edcc6d3e2))
* refuse a review capture that lost the round's response ([#10](https://github.com/angelopublio/agent-spartan-protocol-relay/issues/10)) ([ae40e5d](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/ae40e5d53dc1088b19d124efc46a5b27542cb4fb))
* reuse a free agent pane instead of splitting one per round ([c76fc11](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/c76fc11d4322473902cb9a5f1e986a9b9867b9b7))

## [0.1.0](https://github.com/angelopublio/agent-spartan-protocol-relay/compare/v0.1.0...v0.1.0) (2026-11-26)


### Features

* relay and cockpit for the Agent Spartan Protocol in herdr ([b449ec7](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/b449ec76957484e95c5119dbf89cd53017f84f57))
* spartan-relay workspace opens or recreates a repository's herdr workspace ([#1](https://github.com/angelopublio/agent-spartan-protocol-relay/issues/1)) ([1f74656](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/1f74656b1c0290481a6dd6ef6568ecb62fc4cc4a))


### Bug Fixes

* accept only the protocol's canonical handoff identifiers ([#3](https://github.com/angelopublio/agent-spartan-protocol-relay/issues/3)) ([a9d7cf1](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/a9d7cf10ee30e62390466fff513a5e2025667e7c))
* explain a handoff identifier outside the HX-NNN format ([#2](https://github.com/angelopublio/agent-spartan-protocol-relay/issues/2)) ([ffa3ebf](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/ffa3ebf374afe76d4ba524e5b10334411f592805))
* press Enter once when a prompt sits unsent in the agent's input box ([#5](https://github.com/angelopublio/agent-spartan-protocol-relay/issues/5)) ([dc5f6fa](https://github.com/angelopublio/agent-spartan-protocol-relay/commit/dc5f6fa686a63e0121b17514c9d3b8622859bc17))
