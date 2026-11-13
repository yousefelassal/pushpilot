/** One line of `pushpilot doctor` output. Internal. */
export interface DoctorCheck {
	name: string;
	ok: boolean;
	message: string;
}

/** Flags accepted by the CLI; value-less flags map to `true`. Internal. */
export type Flags = Map<string, string | true>;

/** Environment used by `doctor`, after merging `--env-file` under `process.env`. Internal. */
export type DoctorEnv = Record<string, string | undefined>;

/** A freshly generated VAPID key pair and its fingerprint. Internal. */
export interface GeneratedKeys {
	publicKey: string;
	privateKey: string;
	keyId: string;
}
