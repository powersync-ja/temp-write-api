So the case is: a Postgres composite type like location_address(street, city, state, zip)  
 gets synced down to SQLite as a TEXT column containing JSON — e.g., {"street":"1000 S
Colorado Blvd.","city":"Denver","state":"CO","zip":80211}.

On the write path, that value arrives in op_data as a string (because SQLite stored it as  
 TEXT). The JSON going into json_populate_record would look like:

{"address": "{\"street\":\"1000 S Colorado Blvd.\",\"city\":\"Denver\",...}"}

That's a string value for a composite type column — json_populate_record can't cast that.  
 It needs the value to be a JSON object, not a JSON string.

This is exactly where the custom mapper plugs in. You'd JSON.parse it in the mapper so that
by the time it hits json_populate_record, the value is a proper object:

import { defaultMapper, type EntryMapper } from './mapping/index.js';

const customMapper: EntryMapper = (entry) => {  
 const mapped = defaultMapper(entry);
if (!mapped) return null;

    if (mapped.table === 'locations' && mapped.data.address) {
      return {
        ...mapped,
        data: {
          ...mapped.data,
          address: JSON.parse(mapped.data.address as string)
        }
      };
    }

    return mapped;

};

const persister = createPostgresPersister(uri, customMapper);

Now json_populate_record sees:

{"address": {"street": "1000 S Colorado Blvd.", "city": "Denver", "state": "CO", "zip":
80211}}

And casts the object to the location_address composite type. Same pattern would apply for  
 JSONB columns, arrays, or any case where SQLite stores a complex value as TEXT.
