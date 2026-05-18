import { promises as fs } from "fs";
import path from "path";
import os from "os";

export type DiscoveredPeer = {
  remoteId: string;
  username?: string;
  hostname?: string;
  platform?: string;
  lastModifiedMs: number;
};

const PEERS_DIR = path.join(
  os.homedir(),
  "Library",
  "Preferences",
  "com.carriez.RustDesk",
  "peers",
);

/**
 * Mac 사용자 폴더의 ChainRemote(=RustDesk) peer 파일을 읽어
 * Chang이 한 번이라도 접속한 거래처 PC 목록을 반환한다.
 *
 * 빈 배열을 리턴하는 케이스: 폴더 없음 / 다른 머신에서 admin panel 실행 중.
 */
export async function discoverPeers(): Promise<DiscoveredPeer[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(PEERS_DIR);
  } catch {
    return [];
  }

  const peers: DiscoveredPeer[] = [];
  await Promise.all(
    entries.map(async (file) => {
      if (!file.endsWith(".toml")) return;
      const id = file.replace(/\.toml$/, "");
      if (!/^\d+$/.test(id)) return;

      const fullPath = path.join(PEERS_DIR, file);
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath, "utf8"),
          fs.stat(fullPath),
        ]);
        peers.push({
          remoteId: id,
          username: extractTomlString(content, "username"),
          hostname: extractTomlString(content, "hostname"),
          platform: extractTomlString(content, "platform"),
          lastModifiedMs: stat.mtimeMs,
        });
      } catch {
        // skip unreadable
      }
    }),
  );

  peers.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  return peers;
}

function extractTomlString(content: string, key: string): string | undefined {
  // [info] 섹션의 username = 'foo' 패턴만 단순 추출 (TOML 파서 도입 회피)
  const re = new RegExp(`^${key}\\s*=\\s*['"](.*?)['"]`, "m");
  const m = content.match(re);
  return m?.[1];
}
