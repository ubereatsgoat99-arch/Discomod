from __future__ import absolute_import, print_function, unicode_literals

from astropy.units import Quantity

from wolframclient.utils.dispatch import Dispatch

encoder = Dispatch()


@encoder.dispatch(Quantity)
def encode_quantity(serializer, o):

    # this is a patch for Quantity that for some reason is a subclass of a numpy array withtout really being a numpy array.
    # this implementation should also be revisited because ideally it should just be able to forward the object the fallback implementation without repeating it.

    if serializer.object_processor:
        return serializer.object_processor(serializer, o)

    raise NotImplementedError("Cannot serialize object of class %s" % o.__class__)
