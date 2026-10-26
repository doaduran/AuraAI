"""Set spatial metadata for the fully convolutional U2NetP network.

Weights and operators are unchanged. A 256x256 working grid lowers activation
memory; the mask is resized back to the display image by app.py.
"""
import sys
import onnx

def prepare(source, destination, side=256):
    model = onnx.load(source)
    dimensions = model.graph.input[0].type.tensor_type.shape.dim
    dimensions[2].dim_value = side
    dimensions[3].dim_value = side
    for output in model.graph.output:
        dims = output.type.tensor_type.shape.dim
        dims[2].dim_value = side
        dims[3].dim_value = side
    onnx.checker.check_model(model)
    onnx.save(model, destination)

if __name__ == '__main__':
    prepare(sys.argv[1], sys.argv[2])
