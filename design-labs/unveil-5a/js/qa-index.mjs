const scenes = ["landing", "privacy", "save", "encryption", "draw-open", "draw-blind", "draw-verify", "prize"];
const target = document.querySelector("#presets");
for (const direction of ["a", "b", "c"])
  for (const theme of ["dark", "light"])
    for (const width of [1440, 390]) {
      const section = document.createElement("section");
      section.innerHTML = `<h2>${direction.toUpperCase()} / ${theme} / ${width} × ${width === 1440 ? 900 : 844}</h2>`;
      for (const scene of scenes) {
        const link = document.createElement("a");
        link.href = `./index.html?direction=${direction}&theme=${theme}&scene=${scene}&intro=off${scene === "prize" ? "&reveal=1" : ""}`;
        link.textContent = `${direction}-${theme}-${width}-${scene}`;
        link.dataset.width = String(width);
        link.dataset.height = width === 1440 ? "900" : "844";
        section.append(link);
      }
      target.append(section);
    }
