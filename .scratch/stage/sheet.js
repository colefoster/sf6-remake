// Scratch: builds the contact sheets for .scratch/stage/. Not part of the page.
window.sheet = async function (kind) {
  const stage = document.getElementById("stage");
  const play = window.play;
  const shots = [];
  const grab = (label) => shots.push({ url: stage.toDataURL("image/png"), label });
  await play.reset();
  play.pause(true);
  play.boxes(false);
  if (kind === "walk-close" || kind === "walk-far") {
    const span = kind === "walk-close" ? 590 : 1450;
    play.frame(0, span, false, 210);
    const every = kind === "walk-close" ? 8 : 20;
    for (let i = 0; i < 6; i++) {
      grab("f" + i * every + " x" + play.state().p1.x);
      play.press("left", every);
    }
  } else if (kind === "jump") {
    play.frame(null);
    play.step(2);
    play.press("up", 1);
    for (let i = 0; i < 6; i++) {
      grab("f" + i * 7 + " " + play.state().p1.action);
      play.step(7);
    }
  } else if (kind === "boxes") {
    play.boxes(true);
    play.frame(0, 590, false, 210);
    grab("point blank, boxes on");
    play.frame(null);
    play.step(1);
    grab("start, boxes on");
    play.frame(0, 1700, false, 520);
    grab("far, boxes on");
  }
  play.boxes(true);
  play.frame(null);
  const cols = 3;
  const rows = Math.ceil(shots.length / cols);
  const tw = 560;
  const th = Math.round((560 * stage.clientHeight) / stage.clientWidth);
  const out = document.createElement("canvas");
  out.width = cols * tw;
  out.height = rows * (th + 20);
  const g = out.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, out.width, out.height);
  const imgs = await Promise.all(
    shots.map((s) => new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.src = s.url;
    })),
  );
  imgs.forEach((im, i) => {
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * (th + 20);
    g.drawImage(im, x, y, tw, th);
    g.fillStyle = "#9ca3af";
    g.font = "13px monospace";
    g.fillText(shots[i].label, x + 6, y + th + 15);
    g.strokeStyle = "#374151";
    g.strokeRect(x + 0.5, y + 0.5, tw, th);
  });
  return out.toDataURL("image/png");
};
