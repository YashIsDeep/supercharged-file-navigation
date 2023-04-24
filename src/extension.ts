import * as vscode from "vscode";
import * as path from "path";

// helpers
import { removeAsteriskFromEnd } from "./helpers/removeAsteriskFromEnd";
import { checkFileExists } from "./helpers/checkFileExists";

let computeAliasesPromise: Promise<void> | undefined;
let tsconfigFilePaths: string[] = [];
const aliasInfoByScope: Record<string, Record<string, string>> = {};

export async function computeAliases(): Promise<void> {
  if (computeAliasesPromise) {
    return computeAliasesPromise;
  }

  console.time("computeAliases");
  const tsconfigFiles = await vscode.workspace.findFiles(
    "**/tsconfig.json",
    "**/node_modules/**"
  );

  for (const tsconfigFile of tsconfigFiles) {
    const tsconfigString = await vscode.workspace.fs
      .readFile(tsconfigFile)
      .then((data) => data.toString());
    tsconfigFilePaths.push(path.dirname(tsconfigFile.fsPath));
    const tsconfig = JSON.parse(tsconfigString);
    const baseUrl = tsconfig.compilerOptions?.baseUrl ?? ".";

    if (tsconfig.compilerOptions && tsconfig.compilerOptions.paths) {
      for (const [aliasSourcePath, [aliasTargetPath]] of Object.entries<any>(
        tsconfig.compilerOptions.paths
      )) {
        const fullAliasTargetPath: string = aliasTargetPath.startsWith("./")
          ? aliasTargetPath
          : `./${aliasTargetPath}`;
        const analyzedFilePathPrefix = path.join(
          tsconfigFile.path,
          "..",
          baseUrl
        );
        const importedFilePathPrefix = removeAsteriskFromEnd(aliasSourcePath);
        const targetFilePathPrefix = path.join(
          tsconfigFile.path,
          "..",
          removeAsteriskFromEnd(fullAliasTargetPath)
        );

        if (!aliasInfoByScope[analyzedFilePathPrefix]) {
          aliasInfoByScope[analyzedFilePathPrefix] = {};
        }
        aliasInfoByScope[analyzedFilePathPrefix][importedFilePathPrefix] =
          targetFilePathPrefix;
      }
    }
  }

  console.timeEnd("computeAliases");
  console.info(aliasInfoByScope, tsconfigFilePaths);

  return Promise.resolve();
}
computeAliasesPromise = computeAliases();

export function getImportResolverMetadata(document: vscode.TextDocument): {
  documentFilePath: string;
  aliasInfoForDocument: Record<string, string>;
} {
  const aliasScopes = Object.keys(aliasInfoByScope);
  const documentFilePath = document.fileName;
  const matchedScope = aliasScopes.find((aliasScope) =>
    documentFilePath.startsWith(aliasScope)
  );
  const aliasInfoForDocument = matchedScope
    ? aliasInfoByScope[matchedScope]
    : {};

  return { documentFilePath, aliasInfoForDocument };
}

export const throwUnhandledError = (resolvedPath?: string) => {
  throw new Error(
    `Relying on vscode server for non-aliased resolutions ${resolvedPath}`
  );
};

const resolveImportPath = ({
  importPath,
  resolverMetadata: { documentFilePath, aliasInfoForDocument },
}: {
  importPath: string;
  resolverMetadata: {
    documentFilePath: string;
    aliasInfoForDocument: Record<string, string>;
  };
}): string => {
  const aliasKeys = aliasInfoForDocument
    ? Object.keys(aliasInfoForDocument)
    : undefined;

  const matchedAliasSource = aliasKeys?.find((aliasKey) =>
    importPath.startsWith(aliasKey)
  );
  if (matchedAliasSource) {
    return aliasInfoForDocument?.[matchedAliasSource].concat(
      importPath.slice(matchedAliasSource.length)
    ) as string;
  } else if (importPath[0] === ".") {
    return path.join(
      documentFilePath.slice(0, documentFilePath.lastIndexOf("/") + 1),
      importPath
    );
  }
  throwUnhandledError(importPath);

  return importPath;
};

const SUFFIXES_FOR_PATH_RESOLUTION = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  "/index.tsx",
  "/index.ts",
  "/index.jsx",
  "/index.js",
];

export async function findValidResolvedPath(
  resolvedPath: string,
  dirName: string
): Promise<string> {
  for (const suffix of SUFFIXES_FOR_PATH_RESOLUTION) {
    const isValid = await checkFileExists(resolvedPath + suffix);

    if (isValid) {
      return resolvedPath + suffix;
    }
  }

  if (await checkFileExists(resolvedPath + "/package.json")) {
    const packageJsonContents = JSON.parse(
      await vscode.workspace.fs
        .readFile(vscode.Uri.file(resolvedPath + "/package.json"))
        .then((data) => data.toString())
    );

    return findValidResolvedPath(
      path.join(resolvedPath, packageJsonContents.main),
      dirName
    );
  }

  throwUnhandledError(resolvedPath);
  return resolvedPath;

  /** 
  const SUFFIXES_FOR_NODE_MODULES_TYPES_PATH_RESOLUTION = [
    ".d.ts",
    "/index.d.ts",
  ];

  const SUFFIXES_FOR_NODE_MODULES_PATH_RESOLUTION = [
    ...SUFFIXES_FOR_NODE_MODULES_TYPES_PATH_RESOLUTION,
    ...SUFFIXES_FOR_PATH_RESOLUTION,
  ];
  
  const possibleNodeModuleResolutionsPrefixes = tsconfigFilePaths
    .filter((tsConfigFilePath) => dirName.startsWith(tsConfigFilePath))
    .sort((s1, s2) => s2.length - s1.length);
  // Sort in order of greatest length to shortest length

  for (const prefix of possibleNodeModuleResolutionsPrefixes) {
    const nodeModulesTypingsRootResolution =
      prefix + "/node_modules/@types/" + resolvedPath + "/package.json";
    if (await checkFileExists(nodeModulesTypingsRootResolution)) {
      try {
        const packageJson = JSON.parse(
          await vscode.workspace.fs
            .readFile(vscode.Uri.file(nodeModulesTypingsRootResolution))
            .then((data) => data.toString())
        );
        if (packageJson?.typings) {
          const typingsResolution =
            prefix +
            "/node_modules/@types/" +
            resolvedPath +
            "/" +
            packageJson.typings;

          await logCheckedFiles(typingsResolution);
          if (await checkFileExists(typingsResolution)) {
            return typingsResolution;
          }
        }
      } catch (e) {}
    }

    for (const suffix of SUFFIXES_FOR_NODE_MODULES_TYPES_PATH_RESOLUTION) {
      const nodeModulesTypeResolution =
        prefix + "/node_modules/@types/" + resolvedPath + suffix;
      await logCheckedFiles(nodeModulesTypeResolution);
      if (await checkFileExists(nodeModulesTypeResolution)) {
        return nodeModulesTypeResolution;
      }
    }

    for (const suffix of SUFFIXES_FOR_NODE_MODULES_PATH_RESOLUTION) {
      const nodeModulesResolution =
        prefix + "/node_modules/" + resolvedPath + suffix;
      await logCheckedFiles(nodeModulesResolution);
      if (await checkFileExists(nodeModulesResolution)) {
        return nodeModulesResolution;
      }
    }
  }

  throw new Error(`Unable to resolve path ${resolvedPath}`);
  */
}

class CustomDefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | null> {
    const originSelectionRange = document.getWordRangeAtPosition(
      position,
      /[^'"]+/g
    ) as vscode.Range;
    const importPath = document.getText(originSelectionRange);
    const resolverMetadata = getImportResolverMetadata(document);
    const resolvedPath = resolveImportPath({ importPath, resolverMetadata });
    const firstValidResolvedPath = await findValidResolvedPath(
      resolvedPath,
      document.fileName
    );

    const updatedOriginSelectionRange = new vscode.Range(
      new vscode.Position(
        originSelectionRange.start.line,
        originSelectionRange.start.character - 1
      ),
      new vscode.Position(
        originSelectionRange.end.line,
        originSelectionRange.end.character + 1
      )
    );

    return [
      {
        originSelectionRange: updatedOriginSelectionRange,
        targetUri: vscode.Uri.file(firstValidResolvedPath),
        targetRange: new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(0, 0)
        ),
      },
    ];
  }
}

export async function activate(context: vscode.ExtensionContext) {
  await computeAliases();

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [
        { scheme: "file", language: "javascript" },
        { scheme: "file", language: "typescript" },
      ],
      new CustomDefinitionProvider()
    )
  );
}

export function deactivate() {
  computeAliasesPromise = undefined;
  // @ts-ignore
  tsconfigFilePaths = undefined;
  // @ts-ignore
  aliasInfoByScope = undefined;
}
