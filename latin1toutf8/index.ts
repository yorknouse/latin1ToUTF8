import { PrismaClient } from "@prisma/client";
import { loadPyodide } from "pyodide";

const prisma = new PrismaClient();

type ExplainedText = {
  text: string;
  explanation: any[]; // We only care about length of this array
};

interface FTFY {
  fix_and_explain: (input: string) => ExplainedText;
}

const getFTFY = async () => {
  // Don't catch anything, let it crash
  return new Promise<FTFY>((resolve) => {
    loadPyodide().then((pyodide) => {
      pyodide.loadPackage("micropip").then(() => {
        pyodide.FS.mkdir("/wheels");
        pyodide.FS.mount(
          pyodide.FS.filesystems.NODEFS,
          { root: "../python-ftfy/" },
          "/wheels"
        );

        pyodide
          .runPythonAsync(
            `
                  import micropip
                  await micropip.install("emfs:/wheels/wcwidth-0.2.6-py2.py3-none-any.whl")
                  await micropip.install("emfs:/wheels/ftfy-6.1.2-py3-none-any.whl")
                  import ftfy
                  `
          )
          .then(() => {
            const ftfy = pyodide.globals.get("ftfy") as FTFY;
            resolve(ftfy);
          });
      });
    });
  });
};

const main = () => {
  getFTFY().then((ftfy) => {});
};

main();
