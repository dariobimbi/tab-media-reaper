// HTML snippets parsed by tests via new DOMParser().parseFromString(...).
export const imgHtml = `
  <div id="root">
    <img id="hero" src="https://example.com/hero.jpg" alt="">
  </div>`;

// Note: in a parsed-but-not-rendered document, currentSrc is empty until
// the image loads. Tests of currentSrc preference operate on the live
// test page (created dynamically) rather than the parsed fixture.

export const pictureHtml = `
  <div id="root">
    <picture id="pic">
      <source srcset="https://example.com/large.webp" type="image/webp">
      <source srcset="https://example.com/large.jpg" type="image/jpeg">
      <img src="https://example.com/fallback.jpg" alt="">
    </picture>
  </div>`;

export const sourceHtml = pictureHtml; // tests grab the first <source>

export const emptyImgHtml = `
  <div id="root">
    <img id="empty" alt="">
  </div>`;
