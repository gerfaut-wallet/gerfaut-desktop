import { clsx } from "clsx";
import { Eye, EyeOff } from "lucide-react";
import type { Ref } from "react";
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

/** What "Apply node settings" would actually put in place: the server
    every wallet of a network would then talk to, and the Electrum
    certificates a restore would pin without asking again.

    A backup is a file someone can be handed. Agreeing to a toggle that
    only said "replaces your backend choice" meant agreeing to a server
    and a pinned certificate nobody had read — every address of every
    wallet on that network, to whoever wrote the file. Shown, it is a
    choice; hidden, it was a trap. */
function SettingsPreview({ preview }: { preview: BackupPreview }) {
  const { backends, electrum_hosts: hosts } = preview;
  if (backends.length === 0 && hosts.length === 0) return null;
  return (
    <div className="rounded-md bg-sunken px-3 py-2.5">
      <dl className="flex flex-col gap-1.5">
        {backends.map((entry) => (
          <div key={entry.network} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-ui text-xs text-muted">{NETWORK_LABEL[entry.network]}</dt>
            <dd className="selectable min-w-0 break-all font-data text-xs text-text">
              {entry.backend}
            </dd>
          </div>
        ))}
        {hosts.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-ui text-xs text-muted">
              {hosts.length === 1 ? "Pinned certificate" : "Pinned certificates"}
            </dt>
            <dd className="selectable min-w-0 break-all font-data text-xs text-text">
              {hosts.join(", ")}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

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
  inputRef,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Set when the screen has to put the caret here itself. */
  inputRef?: Ref<HTMLInputElement>;
  /** What the field is for, when the screen states it above rather
      than in the label. It is read out when the caret arrives, which a
      live region cannot promise for a panel that appears at the same
      moment as the text inside it. */
  describedBy?: string;
}) {
  const [hidden, setHidden] = useState(true);
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          aria-describedby={describedBy}
          type={hidden ? "password" : "text"}
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className="field-focus h-11 w-full rounded-sm border border-transparent bg-sunken px-3 pr-11 font-ui text-sm text-text"
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

  // The save dialog opens on the Rust side: the screen suggests a name
  // and learns whether the file was written, never where.
  const saveFile = async (made: BackupBundle) => {
    try {
      const written = await ipc.saveBackupFile(made.data, backupFilename());
      if (!written) return;
      showToast("Backup saved");
    } catch (error) {
      showToast(isCommandError(error) ? error.message : String(error));
    }
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

/** Where the backup being restored was read from. A scan closes the
    scanner over the screen and a file dialog covers it, so in both
    cases the person comes back to a page that has to say what it now
    holds, rather than leave a greyed button to explain itself. */
type BackupSource = { kind: "qr" } | { kind: "file"; name: string };

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
  const [from, setFrom] = useState<BackupSource | null>(null);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [applySettings, setApplySettings] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Same reason as the export modal: this one stays mounted too.
  useEffect(() => {
    if (!isOpen) {
      setSource(null);
      setFrom(null);
      setPassword("");
      setProblem(null);
      setPreview(null);
      setChosen(new Set());
      setApplySettings(false);
    }
  }, [isOpen]);

  // The caret follows the backup that just landed. The scanner returns
  // focus to the button that opened it, which is a step already taken;
  // the password is the one that is not.
  useEffect(() => {
    if (from !== null) passwordRef.current?.focus();
  }, [from]);

  const close = () => {
    setSource(null);
    setFrom(null);
    setPassword("");
    setProblem(null);
    setPreview(null);
    setChosen(new Set());
    setApplySettings(false);
    onClose();
  };

  // The file dialog opens on the Rust side, which reads what was picked
  // and hands back its name and contents: no path crosses the bridge.
  const openFile = async () => {
    try {
      const picked = await ipc.pickBackupFile();
      if (picked === null) return;
      setSource(picked.data);
      setFrom({ kind: "file", name: picked.name });
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
          {/* What was read, in the same words for either source and at
              the weight of a fact the screen states — not the grey aside
              a scanner closing over the page reads as a crash. */}
          {from && (
            <div
              id="restore-source"
              className="rounded-lg border border-border bg-background p-4"
            >
              <p className="font-ui text-sm text-text">
                Backup read from{" "}
                {from.kind === "qr" ? (
                  "the QR code"
                ) : (
                  <span className="break-all font-medium">{from.name}</span>
                )}
              </p>
              <p className="mt-0.5 font-ui text-xs text-muted">
                Type its password to open it.
              </p>
            </div>
          )}
          <PasswordField
            id="restore-password"
            label="Password"
            value={password}
            inputRef={passwordRef}
            describedBy={from ? "restore-source" : undefined}
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
              setFrom({ kind: "qr" });
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
                {/* A wallet already watched stays on the list, out of
                    reach: showing what will not be done says more than
                    dropping it, which would read as a backup missing a
                    wallet. Its name steps back to the weight of the
                    line under it — demoted, still readable. */}
                <label
                  className={clsx(
                    "flex items-start gap-2.5",
                    wallet.already_watched ? "cursor-default" : "cursor-pointer",
                  )}
                >
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
                    <span
                      className={clsx(
                        "font-ui text-sm font-medium",
                        wallet.already_watched ? "text-muted" : "text-text",
                      )}
                    >
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
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-ui text-sm font-medium text-text">
                    Apply node settings
                  </p>
                  <p className="font-ui text-xs text-muted">
                    Replaces your backend choice, accepted certificates and gap limit with
                    the backup's.
                  </p>
                </div>
                <Toggle
                  checked={applySettings}
                  onChange={setApplySettings}
                  label="Apply node settings"
                />
              </div>
              <SettingsPreview preview={preview} />
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
