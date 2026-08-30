import { open, save } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatedQr } from "../components/AnimatedQr";
import { Button, IconButton } from "../components/Button";
import { Modal } from "../components/Modal";
import { ScanQrModal } from "../components/ScanQrModal";
import type {
  BackupBundle,
  BackupPreview,
  Network,
  WalletMeta,
} from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";
import { formatTimestamp } from "../lib/format";
import {
  backupFilename,
  formatBytes,
  useExportBackup,
  useImportBackup,
  usePreviewBackup,
} from "../state/backup";
import { useInvalidateWallet, useSyncAll } from "../state/queries";
import { useUi } from "../state/store";
import { FieldLabel, Segmented, Toggle } from "./settings/primitives";

const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  signet: "Signet",
  testnet4: "Testnet 4",
  regtest: "Regtest",
};

/** A password typed once here and typed again on the other device: it
    can be read back before it is committed to. */
function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hidden, setHidden] = useState(true);
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <input
          id={id}
          type={hidden ? "password" : "text"}
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full rounded-sm bg-sunken px-3 pr-11 font-ui text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <span className="absolute right-1 top-1/2 -translate-y-1/2">
          <IconButton
            label={hidden ? `Show ${label}` : `Hide ${label}`}
            type="button"
            onClick={() => setHidden(!hidden)}
          >
            {hidden ? (
              <Eye size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <EyeOff size={16} strokeWidth={1.5} aria-hidden />
            )}
          </IconButton>
        </span>
      </div>
    </div>
  );
}

/** Seals the chosen wallets under a password, then hands the result
    over as a file or as an animated QR code. */
export function BackupExportModal({
  open: isOpen,
  onClose,
  wallets,
  activeNetwork,
}: {
  open: boolean;
  onClose: () => void;
  wallets: WalletMeta[];
  activeNetwork: Network;
}) {
  const { showToast } = useUi();
  const exportBackup = useExportBackup();
  const [scope, setScope] = useState<"all" | "network">("all");
  const [includeSettings, setIncludeSettings] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BackupBundle | null>(null);
  const [showQr, setShowQr] = useState(false);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const onNetwork = wallets.filter((w) => w.network === activeNetwork);
  // Both modals stay mounted while closed, so an answer that lands
  // after the user walked away must not come back with the next
  // opening — with the password and the options they abandoned.
  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      setConfirm("");
      setProblem(null);
      setBundle(null);
      setShowQr(false);
    }
  }, [isOpen]);

  const close = () => {
    setPassword("");
    setConfirm("");
    setProblem(null);
    setBundle(null);
    setShowQr(false);
    onClose();
  };

  const create = async () => {
    // The core trims before checking: a stray space is not a character.
    const secret = password.trim();
    if (secret.length < 8) {
      setProblem("Use at least 8 characters.");
      return;
    }
    if (confirm.trim() !== secret) {
      setProblem("The two passwords differ.");
      return;
    }
    setProblem(null);
    try {
      const made = await exportBackup.mutateAsync({
        options: {
          wallet_ids: scope === "all" ? null : onNetwork.map((w) => w.id),
          include_settings: includeSettings,
        },
        password,
      });
      if (!openRef.current) return;
      setBundle(made);
    } catch (error) {
      if (!openRef.current) return;
      setProblem(isCommandError(error) ? error.message : String(error));
    }
  };

  const saveFile = async (made: BackupBundle) => {
    const path = await save({
      defaultPath: backupFilename(),
      filters: [{ name: "Gerfaut backup", extensions: ["gerfaut"] }],
    });
    if (!path) return;
    await ipc.saveBackupFile(path, made.data);
    showToast("Backup saved");
  };

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title="Export a backup"
      width={520}
      z={60}
      centered
    >
      {bundle === null ? (
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Wallets</FieldLabel>
            <Segmented
              label="Wallets"
              value={scope}
              onChange={(value) => setScope(value as "all" | "network")}
              options={[
                { value: "all", label: `All wallets (${wallets.length})` },
                ...(onNetwork.length === wallets.length
                  ? []
                  : [
                      {
                        value: "network",
                        label: `${NETWORK_LABEL[activeNetwork]} only (${onNetwork.length})`,
                      },
                    ]),
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="font-ui text-sm font-medium text-text">
                Include node settings
              </p>
              <p className="font-ui text-xs text-muted">
                Your backend choice, accepted certificates and gap limit.
              </p>
            </div>
            <Toggle
              checked={includeSettings}
              onChange={setIncludeSettings}
              label="Include node settings"
            />
          </div>
          <PasswordField
            id="backup-password"
            label="Password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setProblem(null);
            }}
          />
          <PasswordField
            id="backup-confirm"
            label="Confirm password"
            value={confirm}
            onChange={(value) => {
              setConfirm(value);
              setProblem(null);
            }}
          />
          <p className="font-ui text-xs text-muted">
            Choose it now and type it on the other device. There is no way to
            recover it.
          </p>
          {problem && <p className="font-ui text-xs text-muted">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={exportBackup.isPending}
              onClick={() => void create()}
            >
              {exportBackup.isPending ? "Creating…" : "Create backup"}
            </Button>
          </div>
        </div>
      ) : showQr ? (
        <div className="flex flex-col items-center gap-4">
          <AnimatedQr frames={bundle.frames} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowQr(false)}>
              Back
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="tabular font-ui text-sm text-text">
            {bundle.wallet_count === 1 ? "1 wallet" : `${bundle.wallet_count} wallets`} ·{" "}
            {formatBytes(bundle.size_bytes)}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void saveFile(bundle)}>
              Save file…
            </Button>
            <Button variant="secondary" onClick={() => setShowQr(true)}>
              Show QR code
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Opens a backup, lists what it holds, and adds what the user picks. */
export function BackupRestoreModal({
  open: isOpen,
  onClose,
  activeNetwork,
}: {
  open: boolean;
  onClose: () => void;
  activeNetwork: Network;
}) {
  const { showToast } = useUi();
  const invalidate = useInvalidateWallet();
  const syncAll = useSyncAll();
  const previewBackup = usePreviewBackup();
  const importBackup = useImportBackup();
  const [source, setSource] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [applySettings, setApplySettings] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Same reason as the export modal: this one stays mounted too.
  useEffect(() => {
    if (!isOpen) {
      setSource(null);
      setSourceLabel("");
      setPassword("");
      setProblem(null);
      setPreview(null);
      setChosen(new Set());
      setApplySettings(false);
    }
  }, [isOpen]);

  const close = () => {
    setSource(null);
    setSourceLabel("");
    setPassword("");
    setProblem(null);
    setPreview(null);
    setChosen(new Set());
    setApplySettings(false);
    onClose();
  };

  const openFile = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [
          { name: "Gerfaut backup", extensions: ["gerfaut"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (typeof path !== "string") return;
      setSource(await ipc.readBackupFile(path));
      setSourceLabel(`File: ${path.split(/[\\/]/).pop() ?? path}`);
      setProblem(null);
    } catch (error) {
      // A file too large, gone, or unreadable: say so rather than
      // leaving a button that does nothing.
      setProblem(message(error));
    }
  };

  const message = (error: unknown) => {
    if (isCommandError(error)) {
      return error.kind === "vault"
        ? "Wrong password, or the file is damaged."
        : error.message;
    }
    return String(error);
  };

  const openBackup = async () => {
    if (source === null) return;
    try {
      const found = await previewBackup.mutateAsync({ source, password });
      setPreview(found);
      setChosen(
        new Set(found.wallets.filter((w) => !w.already_watched).map((w) => w.index)),
      );
      setProblem(null);
    } catch (error) {
      setProblem(message(error));
    }
  };

  const restore = async () => {
    if (source === null || chosen.size === 0) return;
    try {
      const report = await importBackup.mutateAsync({
        source,
        password,
        choices: {
          indexes: [...chosen].sort((a, b) => a - b),
          apply_settings: applySettings,
        },
      });
      // The workspace follows the restored wallets when none of them is
      // on the active network, otherwise they would land invisible.
      let network = activeNetwork;
      if (report.added.length > 0 && !report.added.some((w) => w.network === network)) {
        network = report.added[0].network;
        await ipc.setActiveNetwork(network);
      }
      invalidate();
      const count =
        report.added.length === 1 ? "1 wallet restored" : `${report.added.length} wallets restored`;
      showToast(report.settings_applied ? `${count} · settings applied` : count);
      syncAll.mutate(network);
      close();
    } catch (error) {
      setProblem(message(error));
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title="Restore a backup"
      width={560}
      z={60}
      centered
    >
      {preview === null ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void openFile()}>
              Open a file…
            </Button>
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              Scan a QR code
            </Button>
          </div>
          {sourceLabel && <p className="font-ui text-xs text-muted">{sourceLabel}</p>}
          <PasswordField
            id="restore-password"
            label="Password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setProblem(null);
            }}
          />
          {problem && <p className="font-ui text-xs text-muted">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={source === null || previewBackup.isPending}
              onClick={() => void openBackup()}
            >
              {previewBackup.isPending ? "Opening…" : "Open backup"}
            </Button>
          </div>
          <ScanQrModal
            open={scanOpen}
            onClose={() => setScanOpen(false)}
            onScan={(text) => {
              setSource(text);
              setSourceLabel("QR code scanned");
              setProblem(null);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-ui text-sm text-text">
            Backup from {formatTimestamp(preview.created_at)} ·{" "}
            {preview.wallets.length === 1 ? "1 wallet" : `${preview.wallets.length} wallets`}
          </p>
          <ul className="flex flex-col gap-2">
            {preview.wallets.map((wallet) => (
              <li key={wallet.index}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 accent-primary"
                    checked={chosen.has(wallet.index)}
                    disabled={wallet.already_watched}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      if (event.target.checked) next.add(wallet.index);
                      else next.delete(wallet.index);
                      setChosen(next);
                    }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-ui text-sm font-medium text-text">
                      {wallet.name}
                    </span>
                    <span className="font-ui text-xs text-muted">
                      {NETWORK_LABEL[wallet.network]} ·{" "}
                      {wallet.kind.type === "single_address"
                        ? "Single address"
                        : "Descriptor wallet"}
                      {wallet.already_watched && " · Already watched"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {preview.has_settings && (
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="font-ui text-sm font-medium text-text">
                  Apply node settings
                </p>
                <p className="font-ui text-xs text-muted">
                  Replaces your backend choice and gap limit with the backup's.
                </p>
              </div>
              <Toggle
                checked={applySettings}
                onChange={setApplySettings}
                label="Apply node settings"
              />
            </div>
          )}
          {problem && <p className="font-ui text-xs text-muted">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={chosen.size === 0 || importBackup.isPending}
              onClick={() => void restore()}
            >
              {chosen.size === 1 ? "Restore 1 wallet" : `Restore ${chosen.size} wallets`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
