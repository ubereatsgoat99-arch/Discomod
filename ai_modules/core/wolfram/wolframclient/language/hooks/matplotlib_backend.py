"""
Custom matplotlib backend that sends figure image bytes to Wolfram via wl_print.

Usage:
    import matplotlib
    matplotlib.use('module://backend_hello')
    import matplotlib.pyplot as plt

    plt.plot([1, 2, 3], [4, 5, 6])
    plt.show()
"""

import io
from matplotlib.backend_bases import FigureCanvasBase, FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib._pylab_helpers import Gcf
from wolframclient.language.side_effects import wl_print
from wolframclient.language import wl, wlexpr


class FigureCanvas(FigureCanvasAgg):
    manager_class = type(None)  # placeholder, overridden below


class FigureManager(FigureManagerBase):

    @classmethod
    def pyplot_show(cls, *, block=None):
        for manager in Gcf.get_all_fig_managers():
            manager.show()

    def show(self):
        buf = io.BytesIO()
        self.canvas.figure.savefig(buf, format="png")
        wl_print(wl.ImportByteArray(buf.getvalue(), "PNG"))


FigureCanvas.manager_class = FigureManager
