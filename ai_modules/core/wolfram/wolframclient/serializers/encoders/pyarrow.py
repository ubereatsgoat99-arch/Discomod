from __future__ import absolute_import, print_function, unicode_literals

from wolframclient.utils.api import pyarrow
from wolframclient.utils.dispatch import Dispatch

encoder = Dispatch()


def _encode_batches(serializer, batches, schema):
    buffer = pyarrow.BufferOutputStream()
    stream = pyarrow.ipc.new_stream(buffer, schema)
    for batch in batches or (
        pyarrow.RecordBatch.from_arrays([[] for _ in schema], schema=schema),
    ):
        stream.write_batch(batch)
    return serializer.serialize_function(
        serializer.serialize_symbol(b"ImportByteArray"),
        (
            serializer.serialize_bytes(buffer.getvalue()),
            serializer.serialize_string("ArrowIPC"),
        ),
    )


@encoder.dispatch(pyarrow.RecordBatch)
def encoder_pyarrow_batch(serializer, batch):
    return _encode_batches(serializer, (batch,), batch.schema)


@encoder.dispatch(pyarrow.Table)
def encoder_pyarrow_table(serializer, table):
    return _encode_batches(serializer, table.to_batches(), table.schema)


@encoder.dispatch(pyarrow.Array)
def encoder_pyarrow_array(serializer, array):
    batch = pyarrow.RecordBatch.from_arrays([array], names=[""])

    return serializer.serialize_function(
        serializer.serialize_symbol(b"Part"),
        (
            _encode_batches(serializer, (batch,), batch.schema),
            serializer.serialize_symbol(b"All"),
            serializer.serialize_int(1),
        ),
    )
