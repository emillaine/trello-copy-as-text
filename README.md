# Trello Copy List as Text (Edge / Chrome extension)

Adds a "Copy list as text" row to every Trello list's ... actions menu. Click it to copy all cards in
that list to the clipboard as:

```markdown
## Card title
Card description

## Next card title
Its description
```

No metadata - just `##` + title + description per card, blank line between cards.
Cards with no description copy as title only.

No API token needed: descriptions are fetched via Trello's own board JSON
using your login session (public boards work logged-out).

## Install in Edge

1. Go to `edge://extensions/`
2. Enable **Developer mode** (left sidebar)
3. **Load unpacked** -> select this folder
4. Open any Trello board - each list's ... menu gets a "Copy list as text" row

Same steps work in Chrome via `chrome://extensions/`.

## Files

- `manifest.json` - Manifest V3, clipboard + `trello.com` hosts only
- `content.js` - adds the menu row, reads card order from the page,
  fetches descriptions, writes to clipboard
- `icons/` - store listing icons (16/48/128)
- `PRIVACY.md` - privacy policy for the store listings

## Release to the stores

```sh
zip -r trello-copy-as-text.zip manifest.json content.js icons README.md PRIVACY.md
```

- Chrome Web Store: https://chrome.google.com/webstore/devconsole -
  upload the zip (needs the 128px icon + screenshots you'll take on a board)
- Edge Add-ons: https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview -
  accepts the same zip
- Bump `version` in `manifest.json` for each resubmission
