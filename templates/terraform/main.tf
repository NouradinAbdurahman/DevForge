resource "local_file" "example" {
  filename = var.output_path
  content  = var.content
}
