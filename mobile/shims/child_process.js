const no = () => { throw new Error('Indisponible sur mobile'); };
export const execFile = no;
export const execFileSync = no;
export default { execFile, execFileSync };