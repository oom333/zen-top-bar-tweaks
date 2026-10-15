# Top Bar Tweaks for Zen

Zen hides its top bar (the strip with the minimize, maximize and close buttons) until you push your mouse to the very top of the window. That works great when the window fills the screen, since you can just fling the mouse upward. When the window is smaller and floating somewhere in the middle of the screen, you have to hit a thin 8-pixel strip to get it back.

This mod fixes that, and lets you tune how the bar pops up.

> **Zen Browser only** (tested on 1.23.2b). It hooks into Zen's own top bar, so it won't do anything in Firefox or other Firefox-based browsers.

## Features

- **Stays open when the window isn't at the top of the screen.** Drag the window down a bit, or make it small, and the top bar stays visible so you can always move the window and reach the buttons. The page moves down below the bar instead of being covered.
- **Hides as usual when the window touches the top.** That covers maximized windows and Windows split screen (snapping Zen to one half), so nothing changes there.
- **Just the window buttons (optional).** Instead of the whole bar, only the minimize / maximize / close buttons roll down in the top-right corner. The page gets a matching rounded cut-out around them, so it looks like part of Zen.
- **Pop-up delay.** Make the bar show up instantly, or wait a moment so it doesn't pop up every time your mouse passes by.
- **Trigger range.** Choose how close to the top your mouse has to be, from the very top pixel up to 100 px.
- **Animation speed.** No animation, fast, Zen's default, or slow.

Everything is off or set to Zen's own behavior by default, except "stays open when the window isn't at the top".

"Just the window buttons" works with Zen's usual layout (one toolbar, window buttons in the top bar). If your top bar also shows bookmarks, or it's being kept open because the window isn't at the top, the whole bar is used.

## Install

### With Sine (recommended)

[Sine](https://github.com/CosmoCreeper/Sine) is a mod manager for Zen that can run script mods like this one.

1. Install Sine if you don't have it yet.
2. In Zen, open **Settings → Sine Mods**.
3. This mod runs JavaScript, so until it's listed in Sine's store, turn on installing JS from unofficial sources in Sine's settings.
4. Install it from GitHub by entering `oom333/zen-top-bar-tweaks`.
5. Restart Zen.

### Manually (fx-autoconfig)

1. Set up [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) in Zen.
2. Copy `top-bar-tweaks.uc.js` **and** the `top-bar-tweaks` folder (the settings page) into your profile's `chrome/JS/` folder. Find your profile folder in `about:support` → **Profile Folder**.
3. In `about:support`, click **Clear startup cache…**, then restart Zen.

## Settings

In **Settings → Sine Mods**, click the settings button on Top Bar Tweaks, or right-click the top bar and pick **Top Bar Tweaks settings…**. The settings page has a small live preview you can hover to try your settings. Changes apply right away, with no restart needed.

| Setting | Default |
| --- | --- |
| Pop-up style: whole bar or just the window buttons | Whole bar |
| Keep the top bar open when the window isn't touching the top of the screen | On |
| Wait before it pops up | Zen default |
| How close to the top the mouse has to be | Zen default (top 8 px) |
| Slide animation | Zen default |

Without Sine, set these in `about:config`:

| Pref | Type | Values |
| --- | --- | --- |
| `zen.topbartweaks.show-when-not-at-top` | boolean | `true` / `false` |
| `zen.topbartweaks.style` | string | `bar` or `buttons` |
| `zen.topbartweaks.show-delay` | string | `default`, or milliseconds like `250` |
| `zen.topbartweaks.trigger-range` | string | `default`, or pixels from the top like `40` |
| `zen.topbartweaks.animation` | string | `default`, or seconds like `0.08` (`0` = none) |

## License

MIT. Made with the help of Claude.
