# Vetro 0.5.0 review and build delivery

Updated 2026-11-08. Comments and new PRs below are prepared for manual submission.

## Vetro build

[Download the combined unsigned integration](https://github.com/pponce/vetro/actions/runs/42508536173/artifacts/13627979773) · [passing CI](https://github.com/pponce/vetro/actions/runs/42508536173) · [exact source](https://github.com/pponce/vetro/tree/eb2227342f66cb9a0eb9a855c62fe2f105619793).

Complete rooted integration WGT; rebuilt native launcher; source/hash files included. Sign with the existing compatible TV profile before installing. No TV test is claimed.

## Existing PR messages

| PR | Paste-ready update | Passing CI |
| --- | --- | --- |
| [113](https://github.com/andrearicci93/vetro/pull/113) | [Message](pr-113-update.md) | [Run](https://github.com/pponce/vetro/actions/runs/42507553836) |
| [117](https://github.com/andrearicci93/vetro/pull/117) | [Message](pr-117-update.md) | [Run](https://github.com/pponce/vetro/actions/runs/42507679989) |
| [118](https://github.com/andrearicci93/vetro/pull/118) | [Message](pr-118-update.md) | [Run](https://github.com/pponce/vetro/actions/runs/42507751828) |
| [119](https://github.com/andrearicci93/vetro/pull/119) | [Message](pr-119-update.md) | [Run](https://github.com/pponce/vetro/actions/runs/42507788092) |

PR #119's previous description refers to the replaced stacked/remapper-owner implementation. Its current message explicitly describes the revised proposal. Earlier hardware claims describe earlier builds.

## New PR submission links

- [Vetro double press](https://github.com/andrearicci93/vetro/compare/main...pponce:pr/home-double-press-0.5.0?expand=1&title=Add%20optional%20Home%20double%20press%20with%20an%20independent%20destination&body=Single%20Home%20immediately%20toggles%20the%20Vetro%20overlay%3B%20a%20distinct%20second%20press%20within%20350%20ms%20opens%20an%20independent%20app%20or%20the%20Home%20tile%20destination.%0A%0ADraft%20follow-up%20to%20%23113%2C%20%23117%2C%20%23118%20and%20%23119.%20The%20branch%20is%20stacked%3B%20please%20settle%20Home%20ownership%20and%20rebase%20after%20prerequisites%20merge.%20The%20final%20commit%20contains%20the%20double-press%20feature.%0A%0ACI%20passes%2C%20including%20native%20tests%20and%20TV%20launcher%20compilation.%20Hardware%20acceptance%20remains%20outstanding.%0A%0ADetails%3A%20https%3A%2F%2Fgithub.com%2Fpponce%2Fvetro%2Fblob%2Fnotes%2Fupstream-0.5.0-plan%2Fnotes%2Fnew-pr-double-press.md)
- [Glass Home stock compatibility](https://github.com/pponce/glass-home-samsung-tv/compare/main...compat/stock-vetro-0.5.0?expand=1&title=Support%20stock%20Vetro%200.5.0%20app%20discovery%20and%20artwork&body=Use%20the%20stock%20installed-app%20registry%20and%20Home%20ordering%20through%20the%20local%20service%2C%20including%20eligible%20unpinned%20apps.%20Prefer%20Home-row%20artwork%2C%20then%20package%20icons.%20Preserve%20saved%20selections%2C%20hidden%20state%2C%20custom%20artwork%20and%20guarded%20launch%20behavior%20without%20requiring%20the%20custom%20permissions%20API.%0A%0ATV%20catalog%2Fartwork%20acceptance%20remains%20outstanding.%0A%0ADetails%3A%20https%3A%2F%2Fgithub.com%2Fpponce%2Fvetro%2Fblob%2Fnotes%2Fupstream-0.5.0-plan%2Fnotes%2Fnew-pr-glass-stock.md)
- [Garage Home stock compatibility](https://github.com/pponce/garage-home/compare/feat/vetro-controls...compat/stock-vetro-0.5.0?expand=1&title=Use%20stock%20Vetro%200.5.0%20for%20optional%20TV%20controls&body=Map%20optional%20controls%20through%20the%20authenticated%20local%20service%20to%20stock%20Vetro%20endpoints.%20Preserve%20user-app%20filtering%2C%20close%20confirmation%20and%20verification%2C%20sleep%20cancellation%2C%20brightness%20opt-in%20and%20no%20automatic%20repeat%20after%20uncertain%20commands.%20Sources%20continues%20to%20use%20native%20Tizen%20APIs.%0A%0ATargets%20feat%2Fvetro-controls.%20CI%20and%20browser%20tests%20pass%3B%20TV%20acceptance%20remains%20outstanding.%0A%0ADetails%3A%20https%3A%2F%2Fgithub.com%2Fpponce%2Fvetro%2Fblob%2Fnotes%2Fupstream-0.5.0-plan%2Fnotes%2Fnew-pr-garage-stock.md)

Open double press as a draft: it is stacked on the open Home PRs and awaits ownership agreement. Glass targets its fork's main; Garage targets feat/vetro-controls. No new PR has been opened.

## Issue response and handoff

[Issue #138 response](issue-138-update.md) · [handoff and exact TV acceptance steps](upstream-0.5.0-handoff.md) · [updated plan](upstream-0.5.0-plan.md).

## Client builds

Garage Home: `66f6a378c60cc94dcbb1fc3c3a19fd7c4bcbdbc3` — [passing tests and browser acceptance](https://github.com/pponce/garage-home/actions/runs/42508972819) · [unsigned widget](https://github.com/pponce/garage-home/actions/runs/42508972819/artifacts/13628697593).

Glass Home: `06621f448c956ca582abf1f5fc0b2aab6cec1ae4` — [passing service, API and browser checks](https://github.com/pponce/glass-home-samsung-tv/actions/runs/42509712172) · [unsigned widget](https://github.com/pponce/glass-home-samsung-tv/actions/runs/42509712172/artifacts/13628544795).

All three packages are unsigned and remain untested on the target TV. Use the existing compatible signing profile. The remaining hardware matrix is in the handoff.

