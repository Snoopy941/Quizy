/**
 * Generates a realistic sample PDF (textbook-style chapter) at data/sample.pdf
 * for testing upload + card generation. Run: npx tsx scripts/make-sample-pdf.ts
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const SECTIONS: { heading: string; paragraphs: string[] }[] = [
  {
    heading: "Cell Theory",
    paragraphs: [
      "Cell theory is one of the foundational principles of biology. It states that all living organisms are composed of one or more cells, that the cell is the basic unit of structure and organization in organisms, and that all cells arise from pre-existing cells through cell division.",
      "The theory was developed over decades. Robert Hooke first observed cells in cork in 1665 and coined the term. Matthias Schleiden and Theodor Schwann proposed in 1839 that all living things are made of cells, and Rudolf Virchow added in 1855 that cells only come from other cells.",
    ],
  },
  {
    heading: "Prokaryotic and Eukaryotic Cells",
    paragraphs: [
      "There are two fundamental types of cells. Prokaryotic cells, found in bacteria and archaea, are small, lack a membrane-bound nucleus, and keep their circular DNA in a region called the nucleoid. Eukaryotic cells, found in plants, animals, fungi, and protists, are larger and contain a true nucleus enclosed by a nuclear envelope, plus membrane-bound organelles.",
      "Eukaryotes also contain specialized organelles: mitochondria generate ATP through cellular respiration, the endoplasmic reticulum synthesizes proteins and lipids, and the Golgi apparatus modifies and packages proteins for transport.",
    ],
  },
  {
    heading: "The Plasma Membrane",
    paragraphs: [
      "The plasma membrane is a phospholipid bilayer studded with proteins, cholesterol, and carbohydrates. It is selectively permeable, meaning it controls which substances enter and leave the cell. Small nonpolar molecules such as oxygen and carbon dioxide diffuse freely, while ions and large polar molecules require transport proteins.",
      "Transport across the membrane occurs by passive processes, which require no energy, and active transport, which requires ATP. Diffusion and osmosis are passive; the sodium-potassium pump is an example of active transport that maintains the electrochemical gradient in neurons.",
    ],
  },
  {
    heading: "Mitochondria and Cellular Respiration",
    paragraphs: [
      "Mitochondria are double-membraned organelles known as the powerhouse of the cell. The inner membrane folds into cristae, which increase surface area for the electron transport chain. Cellular respiration converts glucose and oxygen into ATP, carbon dioxide, and water across three stages: glycolysis, the Krebs cycle, and oxidative phosphorylation.",
      "Glycolysis occurs in the cytoplasm and splits one glucose molecule into two pyruvate molecules, yielding a net of two ATP. The Krebs cycle runs in the mitochondrial matrix, and the electron transport chain on the inner membrane produces the bulk of ATP through chemiosmosis.",
    ],
  },
  {
    heading: "Photosynthesis",
    paragraphs: [
      "Photosynthesis is the process by which plants, algae, and some bacteria convert light energy into chemical energy stored in glucose. It takes place in chloroplasts, which contain the green pigment chlorophyll. The overall equation is six carbon dioxide plus six water, in the presence of light, yielding one glucose molecule and six oxygen molecules.",
      "Photosynthesis has two stages. The light-dependent reactions occur in the thylakoid membranes and split water to produce ATP and NADPH. The Calvin cycle occurs in the stroma and uses that ATP and NADPH to fix carbon dioxide into three-carbon sugars.",
    ],
  },
];

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle("Introduction to Cell Biology");
  doc.setAuthor("Quizy Sample Content");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 64;
  const maxWidth = pageWidth - margin * 2;
  const fontSize = 11;
  const lineHeight = 16;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Title page header
  page.drawText("Chapter 4: Introduction to Cell Biology", {
    x: margin,
    y,
    size: 20,
    font: bold,
    color: rgb(0, 0, 0),
  });
  y -= 36;

  const wrap = (text: string, size: number, f: typeof font): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const candidate = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(candidate, size) > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  for (const section of SECTIONS) {
    if (y < margin + 120) newPage();
    y -= 12;
    page.drawText(section.heading, {
      x: margin,
      y,
      size: 15,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight * 1.6;
    for (const para of section.paragraphs) {
      for (const line of wrap(para, fontSize, font)) {
        if (y < margin) newPage();
        page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
        y -= lineHeight;
      }
      y -= lineHeight * 0.7;
    }
  }

  const bytes = await doc.save({ useObjectStreams: false });
  const out = join(process.cwd(), "data", "sample.pdf");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes, ${SECTIONS.length} sections)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
