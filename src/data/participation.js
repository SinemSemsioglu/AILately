// Links between accounts and topics, from X posts in the data window.
// interests[a]: account a's topics, [[topicIndex, weight], …], strongest first (empty if it didn't post)
// participants[t]: indices of the accounts that posted about topic t
import atlas from './atlas.js';

export const interests = atlas.interests;
export const participants = atlas.participants;
