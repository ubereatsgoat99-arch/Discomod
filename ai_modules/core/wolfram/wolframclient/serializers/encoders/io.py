from __future__ import absolute_import, print_function, unicode_literals

import io

from wolframclient.utils.dispatch import Dispatch

encoder = Dispatch()


@encoder.dispatch(io.IOBase.__mro__)
def encode_quantity(serializer, o):

    # we need to patch io objects because we automatically attempt to convert classes that are iterable to a list, however it should not be done in this case. To be improved.

    if serializer.object_processor:
        return serializer.object_processor(serializer, o)

    raise NotImplementedError("Cannot serialize object of class %s" % o.__class__)
