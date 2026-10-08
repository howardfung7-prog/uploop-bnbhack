// Shared transaction identifiers; importing them must not load the account page.
export const stakeBusyId = (tickerId: number) => -90_000 - tickerId;
export const redeemBusyId = (tickerId: number) => -80_000 - tickerId;
