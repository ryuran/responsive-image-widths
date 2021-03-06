# Responsive Image Widths

A command-line tool helping the choice of optimal responsive image widths to put in your `srcset` attribute(s).

Run `node responsive-image-sizes.js -h`

## Steps required to get the image widths list

- [Step 1: get actual contexts (viewports and screen densities) of site visitors](/responsive-image-widths/step1.html)
- [Step 2: get variations of image width across viewport widths](/responsive-image-widths/step2.html)
- [Step 3: compute optimal n widths from both datasets](/responsive-image-widths/step3.html)

## How to deal with multiple `<source>` with `mix/max-width` media queries (Art Direction)

If you have some code like this:

```html
<picture>
  <source media="(min-width: 800px)" srcset="…" sizes="…">
  <img srcset="…" sizes="…" alt="…">
</picture>
```

You will have to run the script twice, with (at least) these parameters, to get widths for both `srcset`s:

```shell
node responsive-image-sizes.js --maxviewport 799
node responsive-image-sizes.js --minviewport 800
```
