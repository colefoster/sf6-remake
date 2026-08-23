/**
 * Re-author the two rear-hand punches. Only `twist` and the two hands move;
 * pelvis, chest, head and both feet are left exactly as they were.
 */
import fs from "node:fs";

/** move -> anchor key -> { twist, hands: [lead, rear] } */
const edits = {
  "5MP": [
    { twist: 0 },
    { twist: 10, hands: [[0.14, 0.7], [-0.115, 0.66]] },
    { twist: 100, hands: [[0.03, 0.71], [0.38, 0.71]] },
    { twist: 100, hands: [[0.03, 0.708], [0.376, 0.708]] },
    { twist: 40, hands: [[0.16, 0.66], [0.19, 0.68]] },
    { twist: 0 },
  ],
  "5HP": [
    { twist: 0 },
    { twist: 5, hands: [[0.16, 0.72], [-0.15, 0.665]] },
    { twist: 115, hands: [[0.045, 0.705], [0.455, 0.76]] },
    { twist: 115, hands: [[0.045, 0.702], [0.45, 0.757]] },
    { twist: 45, hands: [[0.17, 0.665], [0.2, 0.69]] },
    { twist: 0 },
  ],
};

for (const [move, rows] of Object.entries(edits)) {
  const path = `data/poses/ryu/${move}.json`;
  const file = JSON.parse(fs.readFileSync(path, "utf8"));
  if (file.keys.length !== rows.length) throw new Error(`${move}: ${file.keys.length} keys, ${rows.length} edits`);
  file.keys = file.keys.map((key, i) => {
    const row = rows[i];
    const pose = { ...key.pose };
    if (row.hands) pose.hands = row.hands.map(([x, y]) => ({ x, y }));
    // Ordered last so the six points a reader compares between files stay in
    // the same place; 0 is the default and is not written.
    delete pose.twist;
    if (row.twist) pose.twist = row.twist;
    return { ...key, pose };
  });
  fs.writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log("wrote", path);
}
