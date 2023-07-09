import { PrismaClient, articlesDrafts } from "@prisma/client";
import { Presets, SingleBar } from "cli-progress";
import { appendFileSync } from "fs";
import { loadPyodide } from "pyodide";
import { PyProxy } from "pyodide/ffi";

const prisma = new PrismaClient();

type ExplainedText = {
  text: string;
  explanation: any[]; // We only care about length of this array
};

interface FTFY {
  fix_and_explain: (text: string, config: Object) => ExplainedText;
}

type FTFYInit = {
  ftfy: FTFY;
  textFixerConfig: PyProxy;
};

const getFTFY = async () => {
  // Don't catch anything, let it crash
  return new Promise<FTFYInit>((resolve) => {
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

            textFixerConfig = ftfy.TextFixerConfig(unescape_html=False, uncurl_quotes=False, fix_line_breaks=False)
                  `
          )
          .then(() => {
            const ftfy = pyodide.globals.get("ftfy") as FTFY;
            const textFixerConfig = pyodide.globals.get("textFixerConfig");
            resolve({ ftfy, textFixerConfig });
          });
      });
    });
  });
};

const changes = (result: ExplainedText) => result.explanation.length > 0;

const fixAndExplain = (input: string, ftfy: FTFY, textFixerConfig: Object) =>
  ftfy.fix_and_explain(input, textFixerConfig);

const migrate = (row: articlesDrafts, ftfy: FTFY, textFixerConfig: Object) => {
  let query = "\nUPDATE `articlesDrafts` SET ";
  const emptyQueryLength = query.length;

  const resulstMap = new Map<string, ExplainedText>();
  resulstMap.set(
    "articlesDrafts_headline",
    fixAndExplain(row.articlesDrafts_headline, ftfy, textFixerConfig)
  );
  resulstMap.set(
    "articlesDrafts_excerpt",
    fixAndExplain(row.articlesDrafts_excerpt || "", ftfy, textFixerConfig)
  );
  resulstMap.set(
    "articlesDrafts_text",
    fixAndExplain(row.articlesDrafts_text || "", ftfy, textFixerConfig)
  );
  resulstMap.set(
    "articlesDrafts_markdown",
    fixAndExplain(row.articlesDrafts_markdown || "", ftfy, textFixerConfig)
  );

  resulstMap.forEach((explainedText, column) => {
    if (changes(explainedText)) {
      const dontDoubleEscape = (_: string, offset: number, input: string) => {
        if (offset > 0 && input[offset - 1] === "\\") return input;
        else return `${input.slice(0, offset)}\\${input.slice(offset)}`;
      };
      query += `\`${column}\` = "${explainedText.text.replaceAll(
        /(?<!\\)"/g, // Regexp matches all " that are not lead by a \
        '\\"'
      )}", `;
    }
  });

  if (query.length > emptyQueryLength) {
    query = query.substring(0, query.length - 2);
    query += ` WHERE articlesDrafts_id = ${row.articlesDrafts_id};\n\n\n`;

    return query;
  }

  return undefined;
};

const query = (
  rowsPerQuery: number,
  iterations: number,
  ftfy: FTFY,
  textFixerConfig: Object
) => {
  return new Promise<string[]>(async (resolve) => {
    let i = 0;
    const queries: string[] = [];

    const progressBar = new SingleBar(
      { format: "Creating migration | {bar} | {value}/{total} | ETA: {eta}s" },
      Presets.shades_classic
    );
    progressBar.start(iterations, 0);

    while (i < iterations) {
      const rows = await prisma.articlesDrafts.findMany({
        take: rowsPerQuery,
        skip: rowsPerQuery * i,
        orderBy: {
          articlesDrafts_timestamp: "asc",
        },
      });

      rows.forEach((row) => {
        const data = migrate(row, ftfy, textFixerConfig);
        if (data) queries.push(data);
      });
      progressBar.increment();
      i++;
    }

    progressBar.stop();
    resolve(queries);
  });
};

const getDate = () => {
  const date = new Date();
  const formatter = Intl.DateTimeFormat("en-GB", {
    timeStyle: "medium",
    timeZone: "Europe/London",
    dateStyle: "short",
  });

  const dateSplit = formatter.format(date).split(",");
  dateSplit[0] = dateSplit[0].split("/").reverse().join("");
  dateSplit[1] = dateSplit[1].replaceAll(":", "").replaceAll(" ", "");

  return dateSplit.join("");
};

const main = () => {
  getFTFY().then(async (ftfyInit) => {
    const migrationName = `${getDate()}_mojibake_fix.sql`;

    const ftfy = ftfyInit.ftfy;
    const textFixerConfig = ftfyInit.textFixerConfig;

    const nRows = await prisma.articlesDrafts.count();

    const rowsPerQuery = 1000;
    const iterations = Math.ceil(nRows / rowsPerQuery);

    query(rowsPerQuery, iterations, ftfy, textFixerConfig).then((queries) => {
      const progressBar = new SingleBar(
        {
          format:
            "Writing migration file | {bar} | {value}/{total} | ETA: {eta}s",
        },
        Presets.shades_classic
      );
      progressBar.start(queries.length, 0);
      queries.forEach((q) => {
        appendFileSync(migrationName, q);
        progressBar.increment();
      });
      progressBar.stop();
    });
  });
};

main();
