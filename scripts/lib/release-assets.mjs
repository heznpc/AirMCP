/** A public desktop release is complete only when both install paths exist. */
export function verifyReleaseAssets(release, version) {
  const names = [`airmcp-${version}.mcpb`, `AirMCP-${version}.zip`];
  return names.map((name) => {
    const asset = release.assets?.find((candidate) => candidate.name === name);
    if (!asset) throw new Error(`GitHub Release v${version} is missing ${name}`);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`${name} has invalid size: ${asset.size}`);
    }
    if (asset.state !== "uploaded") throw new Error(`${name} has not finished uploading`);
    return asset;
  });
}
