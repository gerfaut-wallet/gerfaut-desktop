// A wallet's two descriptors as one: the receive branch and the change
// branch written as a single BIP-389 multipath descriptor (`/<0;1>/*`),
// the form a wallet is usually imported and exported in. The core keeps
// the two apart; a page that showed only the receive one handed whoever
// copied it a wallet without its change.

/** The characters a descriptor may hold, in the order the BIP-380
    checksum reads them. */
const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}" +
  "IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~" +
  'ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';
const CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(c: bigint, value: number): bigint {
  const top = c >> 35n;
  let next = ((c & 0x7ffffffffn) << 5n) ^ BigInt(value);
  for (let i = 0; i < 5; i++) {
    if ((top >> BigInt(i)) & 1n) next ^= GENERATOR[i];
  }
  return next;
}

/** The eight-character BIP-380 checksum of a descriptor written without
    one, or null when it holds a character no descriptor may. */
export function descriptorChecksum(body: string): string | null {
  let c = 1n;
  let group = 0;
  let count = 0;
  for (const char of body) {
    const position = INPUT_CHARSET.indexOf(char);
    if (position === -1) return null;
    c = polymod(c, position & 31);
    group = group * 3 + (position >> 5);
    count += 1;
    if (count === 3) {
      c = polymod(c, group);
      group = 0;
      count = 0;
    }
  }
  if (count > 0) c = polymod(c, group);
  for (let i = 0; i < 8; i++) c = polymod(c, 0);
  c ^= 1n;
  let checksum = "";
  for (let i = 0; i < 8; i++) {
    checksum += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & 31n)];
  }
  return checksum;
}

/** The descriptor without its checksum, when the checksum it carries is
    the right one; null otherwise. */
function verifiedBody(descriptor: string): string | null {
  const [body, checksum, ...rest] = descriptor.split("#");
  if (rest.length > 0 || checksum === undefined) return null;
  return descriptorChecksum(body) === checksum ? body : null;
}

/** The child step before each wildcard: `/0/*`, `/1/*'`. */
const STEP = /\/(\d+)\/\*(['h]?)/g;

/** The receive and change descriptors as one multipath descriptor, with
    its checksum; null when they are not one wallet's two branches, the
    same text but for the step before each wildcard. Each descriptor's
    own checksum is checked first, which also checks the one computed
    here. */
export function multipathDescriptor(external: string, internal: string): string | null {
  const receive = verifiedBody(external);
  const change = verifiedBody(internal);
  if (receive === null || change === null) return null;
  const receiveSteps = [...receive.matchAll(STEP)];
  const changeSteps = [...change.matchAll(STEP)];
  if (receiveSteps.length === 0 || receiveSteps.length !== changeSteps.length) return null;
  if (receive.replace(STEP, "/*$2") !== change.replace(STEP, "/*$2")) return null;
  let differs = false;
  let index = 0;
  const body = receive.replace(STEP, (_, step: string, hardened: string) => {
    const [, other] = changeSteps[index++];
    if (step === other) return `/${step}/*${hardened}`;
    differs = true;
    return `/<${step};${other}>/*${hardened}`;
  });
  if (!differs) return null;
  const checksum = descriptorChecksum(body);
  return checksum === null ? null : `${body}#${checksum}`;
}
