# Accessibility verification plan

Automated CI runs axe against the built site. Each significant UI release must also record the following manual checks:

| Check | Evidence to record | Owner/status |
|---|---|---|
| Keyboard-only navigation | Tab order, skip link, visible focus, modal trap/restore, carousel controls | `[complete]` |
| 200% zoom | No loss of content/functionality at 200% browser zoom | `[complete]` |
| 320px reflow | No horizontal scrolling or clipped controls at 320 CSS px | `[complete]` |
| Screen reader | Landmark/name/label/error announcements in a supported screen reader | `[complete]` |
| Reduced motion | Autoplay disabled and no essential motion dependency | `[complete]` |
| Contrast | WCAG 2.0 AA contrast sample report for text, focus, errors, and controls | `[complete]` |

Attach screenshots or tool reports to the release record. A passing automated scan does not replace manual assistive-technology testing.
