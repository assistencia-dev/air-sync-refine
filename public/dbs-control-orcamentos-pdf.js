/* DBS AIR — commercial proposal PDF, aligned with the work-order document system. */
(function () {
  "use strict";

  var theme = {
    blue: [2, 132, 199],
    navy: [15, 47, 87],
    green: [34, 197, 94],
    ink: [31, 41, 55],
    muted: [100, 116, 139],
    line: [214, 222, 231],
    soft: [243, 248, 252],
    panel: [248, 250, 252],
  };
  var logoUrl = "/__l5e/assets-v1/4588320a-68f8-4932-9a72-8f318ecd3268/logo-dbs-air.jpg";
  var resourcesPromise;
  var company = {
    name: "DBS AIR REFRIGERACAO LTDA - ME",
    cnpj: "13.352.707/0001-09",
    email: "assistencia@dbsair.com.br",
    phone: "(21) 99825-6991",
    address: "Rua Nabor do Rego, 481 (ou nº 2908), Ramos, Rio de Janeiro - RJ · CEP 21031-720",
  };

  function clean(value) {
    return value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value).trim();
  }

  function present(value) {
    return clean(value) !== "";
  }

  function number(value, fallback) {
    if (value == null || value === "") return fallback == null ? 0 : fallback;
    if (typeof value === "number")
      return Number.isFinite(value) ? value : fallback == null ? 0 : fallback;
    var raw = String(value)
      .replace(/R\$\s*/g, "")
      .trim();
    var parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
    return Number.isFinite(parsed) ? parsed : fallback == null ? 0 : fallback;
  }

  function money(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
      number(value, 0),
    );
  }

  function unique(values) {
    return Array.from(new Set(values.map(clean).filter(Boolean))).join(" · ");
  }

  function formatDate(value) {
    var raw = clean(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.split("-").reverse().join("/");
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      var date = new Date(raw);
      return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("pt-BR");
    }
    return raw || "—";
  }

  function address(value) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";
    return unique([
      value.street || value.logradouro,
      value.number || value.numero,
      value.complement || value.complemento,
      value.neighborhood || value.bairro,
      value.city || value.cidade || value.municipio,
      value.state || value.estado || value.uf,
      value.zipCode || value.cep,
    ]);
  }

  function base64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    for (var index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 8192));
    }
    return window.btoa(binary);
  }

  function fetchFont(url) {
    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error("Não foi possível carregar as fontes do documento.");
        return response.arrayBuffer();
      })
      .then(base64);
  }

  function trimLogo(canvas, context) {
    if (!context || typeof context.getImageData !== "function") return canvas;
    var pixels;
    try {
      pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (_) {
      return canvas;
    }

    var left = canvas.width;
    var top = canvas.height;
    var right = -1;
    var bottom = -1;
    for (var y = 0; y < canvas.height; y++) {
      for (var x = 0; x < canvas.width; x++) {
        var offset = (y * canvas.width + x) * 4;
        if (
          pixels[offset + 3] > 24 &&
          (pixels[offset] < 244 || pixels[offset + 1] < 244 || pixels[offset + 2] < 244)
        ) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left || bottom < top) return canvas;

    var padX = Math.ceil(canvas.width * 0.025);
    var padY = Math.ceil(canvas.height * 0.035);
    var originX = Math.max(0, left - padX);
    var originY = Math.max(0, top - padY);
    var width = Math.min(canvas.width - originX, right - left + 1 + padX * 2);
    var height = Math.min(canvas.height - originY, bottom - top + 1 + padY * 2);
    var cropped = document.createElement("canvas");
    cropped.width = width;
    cropped.height = height;
    var croppedContext = cropped.getContext("2d");
    if (!croppedContext) return canvas;
    croppedContext.drawImage(canvas, originX, originY, width, height, 0, 0, width, height);
    return cropped;
  }

  function loadImage(source, label, cropLogo) {
    var src =
      typeof source === "object" && source ? source.data || source.url || source.src : source;
    if (!present(src))
      return Promise.reject(
        new Error("O arquivo de " + label + " não possui endereço para exportação."),
      );
    var resolved = clean(src);
    if (!/^(data:|blob:|https?:|\/)/i.test(resolved) && /^[A-Za-z0-9+/=\s]+$/.test(resolved)) {
      resolved = "data:image/png;base64," + resolved;
    }

    return new Promise(function (resolve, reject) {
      var image = new Image();
      var timeout = setTimeout(function () {
        reject(new Error("O carregamento de " + label + " demorou demais."));
      }, 15000);
      if (!resolved.startsWith("data:")) image.crossOrigin = "anonymous";
      image.onload = function () {
        clearTimeout(timeout);
        try {
          var canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          var context = canvas.getContext("2d");
          if (!context || !canvas.width || !canvas.height) throw new Error("Imagem inválida");
          context.drawImage(image, 0, 0);
          var output = cropLogo ? trimLogo(canvas, context) : canvas;
          resolve({
            data: output.toDataURL("image/png"),
            width: output.width,
            height: output.height,
          });
        } catch (_) {
          reject(new Error("Não foi possível preparar " + label + " para o PDF."));
        }
      };
      image.onerror = function () {
        clearTimeout(timeout);
        reject(new Error("Não foi possível carregar " + label + "."));
      };
      image.src = resolved;
    });
  }

  function prepare() {
    if (!resourcesPromise) {
      resourcesPromise = Promise.all([
        fetchFont("/fonts/dbs-document-regular.ttf"),
        fetchFont("/fonts/dbs-document-bold.ttf"),
        loadImage(logoUrl, "a logo DBS AIR", true).catch(function () {
          return null;
        }),
      ]).catch(function (error) {
        resourcesPromise = null;
        throw error;
      });
    }
    return resourcesPromise;
  }

  function statusPalette(status) {
    var normalized = clean(status).toLocaleLowerCase("pt-BR");
    if (/aprov|convertid/.test(normalized)) return { fill: [220, 252, 231], ink: [22, 101, 52] };
    if (/rejeit|cancel/.test(normalized)) return { fill: [254, 226, 226], ink: [153, 27, 27] };
    if (/andamento|atendimento/.test(normalized))
      return { fill: [219, 234, 254], ink: [30, 64, 175] };
    return { fill: [241, 245, 249], ink: theme.muted };
  }

  function lineAmount(item) {
    if (item.total != null && item.total !== "" && Number.isFinite(Number(item.total)))
      return Number(item.total);
    return number(item.quantidade, 1) * number(item.valorUnitario, 0);
  }

  function generate(quote, items, state) {
    return Promise.resolve().then(async function () {
      if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") {
        throw new Error(
          "A biblioteca de PDF não foi carregada. Atualize a página e tente novamente.",
        );
      }
      var source = JSON.parse(JSON.stringify(quote || {}));
      var rows = JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
      var snapshot = JSON.parse(JSON.stringify(state || {}));
      if (!rows.length) throw new Error("Esta proposta não contém itens para exportar.");

      var resources = await prepare();
      var regularFont = resources[0];
      var boldFont = resources[1];
      var logo = resources[2];
      var doc = new window.jspdf.jsPDF({
        unit: "mm",
        format: "a4",
        orientation: "portrait",
        compress: true,
      });
      doc.addFileToVFS("DBS-Quote-Regular.ttf", regularFont);
      doc.addFont("DBS-Quote-Regular.ttf", "DBSQuote", "normal");
      doc.addFileToVFS("DBS-Quote-Bold.ttf", boldFont);
      doc.addFont("DBS-Quote-Bold.ttf", "DBSQuote", "bold");

      var pageWidth = 210;
      var margin = 15;
      var contentWidth = 180;
      var contentBottom = 278;
      var quoteId = clean(source.id || "ORÇAMENTO");
      var status = clean(source.status || "Rascunho");
      var client =
        (snapshot.clientes || []).find(function (entry) {
          return String(entry.id) === String(source.clienteId);
        }) || {};
      var title = clean(source.titulo || source.tituloProposta);
      var discount = number(source.desconto, 0);
      var subtotalProducts =
        source.subtotalProdutos != null
          ? number(source.subtotalProdutos, 0)
          : rows
              .filter(function (item) {
                return item.tipo === "peca";
              })
              .reduce(function (sum, item) {
                return sum + lineAmount(item);
              }, 0);
      var subtotalServices =
        source.subtotalServicos != null
          ? number(source.subtotalServicos, 0)
          : rows
              .filter(function (item) {
                return item.tipo !== "peca";
              })
              .reduce(function (sum, item) {
                return sum + lineAmount(item);
              }, 0);
      var computedSubtotal = rows.reduce(function (sum, item) {
        return sum + lineAmount(item);
      }, 0);
      var subtotal =
        source.subtotal != null ? number(source.subtotal, computedSubtotal) : computedSubtotal;
      var total =
        source.total != null ? number(source.total, subtotal - discount) : subtotal - discount;
      var acceptance =
        source.aceiteWeb && typeof source.aceiteWeb === "object" ? source.aceiteWeb : null;
      var acceptanceSignature =
        acceptance && acceptance.assinatura
          ? await loadImage(acceptance.assinatura, "a assinatura de aceite", false).catch(
              function () {
                return null;
              },
            )
          : null;
      var y = 0;
      var sectionNumber = 0;

      doc.setProperties({
        title: "DBS AIR · Proposta " + quoteId,
        subject: title || "Proposta comercial",
        author: company.name,
        creator: "DBS Control",
      });

      function font(size, weight, color) {
        doc.setFont("DBSQuote", weight || "normal");
        doc.setFontSize(size || 9);
        doc.setTextColor.apply(doc, color || theme.ink);
      }

      function wrap(value, width, size, weight) {
        font(size || 8.5, weight || "normal");
        return doc.splitTextToSize(clean(value), width);
      }

      function line(at, color) {
        doc.setDrawColor.apply(doc, color || theme.line);
        doc.setLineWidth(0.25);
        doc.line(margin, at, margin + contentWidth, at);
      }

      function drawHeader(firstPage) {
        if (firstPage) {
          var top = 10;
          var height = 34;
          doc.setFillColor.apply(doc, theme.panel);
          doc.setDrawColor.apply(doc, theme.line);
          doc.setLineWidth(0.35);
          doc.rect(margin, top, contentWidth, height, "FD");
          doc.setFillColor.apply(doc, theme.blue);
          doc.rect(margin, top, 1.5, height, "F");
          doc.setFillColor.apply(doc, theme.green);
          doc.rect(margin + 1.5, top, 0.7, height, "F");

          if (logo) {
            var scale = Math.min(48 / logo.width, 22 / logo.height);
            var logoWidth = logo.width * scale;
            var logoHeight = logo.height * scale;
            doc.addImage(
              logo.data,
              "PNG",
              margin + 6,
              top + (height - logoHeight) / 2,
              logoWidth,
              logoHeight,
            );
          } else {
            font(14, "bold", theme.navy);
            doc.text("DBS AIR", margin + 7, top + 20);
            font(6.5, "bold", theme.blue);
            doc.text("REFRIGERAÇÃO", margin + 7, top + 25);
          }

          font(7.2, "bold", theme.blue);
          doc.text("PROPOSTA COMERCIAL", pageWidth - margin, 17, { align: "right" });
          var idLines = wrap("Nº " + quoteId, 115, 10, "bold");
          doc.text(idLines, pageWidth - margin, 25, { align: "right" });
          var badge = statusPalette(status);
          var badgeWidth = Math.min(
            68,
            Math.max(29, doc.getTextWidth(status.toLocaleUpperCase("pt-BR")) + 10),
          );
          doc.setFillColor.apply(doc, badge.fill);
          doc.roundedRect(pageWidth - margin - badgeWidth, 29, badgeWidth, 8, 2, 2, "F");
          font(7.1, "bold", badge.ink);
          doc.text(status.toLocaleUpperCase("pt-BR"), pageWidth - margin - 4, 34.2, {
            align: "right",
            maxWidth: badgeWidth - 8,
          });
          y = 50;
          line(y, theme.blue);
          y += 8;
        } else {
          doc.setFillColor.apply(doc, theme.blue);
          doc.rect(margin, 11, contentWidth, 1, "F");
          doc.setFillColor.apply(doc, theme.green);
          doc.rect(margin, 11, 16, 1, "F");
          font(7.8, "bold", theme.navy);
          doc.text("DBS AIR · PROPOSTA COMERCIAL", margin, 18);
          var repeatedId = wrap("PROPOSTA " + quoteId, 100, 7.5);
          doc.text(repeatedId, pageWidth - margin, 18, { align: "right" });
          var repeatedLineY = 23 + Math.max(0, repeatedId.length - 1) * 3.5;
          line(repeatedLineY);
          y = repeatedLineY + 7;
        }
      }

      function newPage() {
        doc.addPage();
        drawHeader(false);
      }

      function ensureSpace(height) {
        if (y + height > contentBottom) newPage();
      }

      function sectionHeading(label, minimum) {
        ensureSpace(12 + (minimum || 12));
        sectionNumber += 1;
        doc.setFillColor.apply(doc, theme.blue);
        doc.rect(margin, y - 3, 7, 7, "F");
        font(6.8, "bold", [255, 255, 255]);
        doc.text(String(sectionNumber).padStart(2, "0"), margin + 3.5, y + 1.8, {
          align: "center",
        });
        font(8.5, "bold", theme.navy);
        doc.text(clean(label).toLocaleUpperCase("pt-BR"), margin + 10, y + 1.5);
        line(y + 5);
        y += 10;
      }

      function pair(left, right) {
        var cells = [left, right].filter(function (cell) {
          return present(cell[1]);
        });
        if (!cells.length) return;
        var widths = cells.length === 2 ? [87, 87] : [contentWidth];
        var wrapped = cells.map(function (cell, index) {
          return wrap(cell[1], widths[index], 8.8);
        });
        var height =
          7.4 +
          Math.max.apply(
            null,
            wrapped.map(function (part) {
              return part.length;
            }),
          ) *
            4.2;
        if (height > 180) {
          cells.forEach(function (cell) {
            paragraph(cell[0], cell[1]);
          });
          return;
        }
        ensureSpace(height);
        cells.forEach(function (cell, index) {
          var x = margin + index * 93;
          font(7, "bold", theme.muted);
          doc.text(clean(cell[0]).toLocaleUpperCase("pt-BR"), x, y);
          font(8.8, "normal", theme.ink);
          doc.text(wrapped[index], x, y + 4.8);
        });
        y += height;
      }

      function paragraph(label, value) {
        if (!present(value)) return;
        var rows = wrap(value, contentWidth - 8, 8.2);
        var offset = 0;
        while (offset < rows.length) {
          var available = Math.floor((contentBottom - y - 17) / 4.4);
          if (available < 1) {
            newPage();
            continue;
          }
          var take = Math.min(rows.length - offset, available);
          var boxHeight = 12 + take * 4.4;
          ensureSpace(boxHeight + 2);
          doc.setFillColor.apply(doc, theme.soft);
          doc.setDrawColor.apply(doc, theme.line);
          doc.setLineWidth(0.3);
          doc.rect(margin, y, contentWidth, boxHeight, "FD");
          font(7, "bold", theme.navy);
          doc.text(
            offset
              ? clean(label).toLocaleUpperCase("pt-BR") + " · CONTINUAÇÃO"
              : clean(label).toLocaleUpperCase("pt-BR"),
            margin + 4,
            y + 4.5,
          );
          font(8.2, "normal", theme.ink);
          doc.text(rows.slice(offset, offset + take), margin + 4, y + 9);
          y += boxHeight + 4;
          offset += take;
          if (offset < rows.length) newPage();
        }
      }

      function drawIssuer() {
        ensureSpace(21);
        doc.setFillColor.apply(doc, theme.panel);
        doc.setDrawColor.apply(doc, theme.line);
        doc.setLineWidth(0.25);
        doc.rect(margin, y, contentWidth, 18, "FD");
        font(7, "bold", theme.navy);
        doc.text(company.name + " · CNPJ " + company.cnpj, margin + 4, y + 4.5);
        font(6.8, "normal", theme.muted);
        doc.text(company.email + " · " + company.phone, margin + 4, y + 9);
        doc.text(company.address, margin + 4, y + 13.5, { maxWidth: contentWidth - 8 });
        y += 22;
      }

      function tableHead() {
        ensureSpace(12);
        doc.setFillColor.apply(doc, theme.soft);
        doc.rect(margin, y - 3, contentWidth, 8, "F");
        font(7, "bold", theme.navy);
        doc.text("DESCRIÇÃO / ESCOPO", margin + 2, y + 2);
        doc.text("QTD. / UN.", 118, y + 2, { align: "right" });
        doc.text("UNITÁRIO / BASE", 153, y + 2, { align: "right" });
        doc.text("TOTAL", pageWidth - margin - 2, y + 2, { align: "right" });
        y += 9;
      }

      function drawItem(item) {
        var description = wrap(item.descricao || item.nome || "Item", 87, 8.1);
        var quantity = number(item.quantidade, 1);
        var quantityLabel =
          quantity.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) +
          " " +
          clean(item.unidade || "UN");
        var unitLabel =
          money(item.valorUnitario) + " / " + clean(item.unidadePreco || item.unidade || "UN");
        var totalLabel = money(lineAmount(item));
        var offset = 0;
        var firstChunk = true;

        while (offset < description.length) {
          var available = Math.floor((contentBottom - y - 4) / 4.3);
          if (available < 1) {
            newPage();
            tableHead();
            continue;
          }
          var take = Math.min(description.length - offset, available);
          font(8.1, "normal", theme.ink);
          doc.text(description.slice(offset, offset + take), margin + 2, y + 1);
          if (firstChunk) {
            font(7.5, "normal", theme.ink);
            doc.text(quantityLabel, 118, y + 1, { align: "right", maxWidth: 26 });
            doc.text(unitLabel, 153, y + 1, { align: "right", maxWidth: 32 });
            font(7.5, "bold", theme.ink);
            doc.text(totalLabel, pageWidth - margin - 2, y + 1, { align: "right", maxWidth: 38 });
            firstChunk = false;
          }
          y += take * 4.3 + 3;
          line(y - 1);
          offset += take;
          if (offset < description.length) {
            newPage();
            tableHead();
          }
        }
      }

      function drawTotals() {
        var rows = [
          ["Subtotal de produtos", subtotalProducts],
          ["Subtotal de serviços", subtotalServices],
          ["Subtotal geral", subtotal],
        ];
        if (discount > 0) rows.push(["Desconto", -discount]);
        var required = rows.length * 5.4 + 17;
        ensureSpace(required);
        y += 3;
        var labelX = 150;
        var totalBoxX = margin;
        rows.forEach(function (row) {
          font(7.8, "normal", theme.muted);
          doc.text(row[0], labelX, y, { align: "right" });
          font(7.8, "normal", theme.ink);
          doc.text(
            row[1] < 0 ? "− " + money(Math.abs(row[1])) : money(row[1]),
            pageWidth - margin - 2,
            y,
            { align: "right" },
          );
          y += 5.4;
        });
        doc.setFillColor.apply(doc, theme.navy);
        doc.rect(totalBoxX, y - 3.8, contentWidth, 11, "F");
        font(8, "bold", [255, 255, 255]);
        doc.text("TOTAL DA PROPOSTA", totalBoxX + 4, y + 3.2);
        doc.text(money(total), pageWidth - margin - 4, y + 3.2, { align: "right" });
        y += 15;
      }

      function drawAcceptance() {
        if (!acceptance) return;
        var events = Array.isArray(acceptance.historico) ? acceptance.historico : [];
        var rows = events.length ? events : [acceptance];
        if (
          !rows.some(function (event) {
            return present(event.status || acceptance.status);
          })
        )
          return;
        sectionHeading("Aceite e histórico comercial");
        rows.forEach(function (event, index) {
          var eventStatus = event.status || acceptance.status || "Registrado";
          pair(
            [index ? "Decisão " + (index + 1) : "Decisão", eventStatus],
            ["Responsável", event.responsavel || acceptance.responsavel],
          );
          pair(
            ["Data do registro", formatDate(event.data || acceptance.data)],
            ["Identificação", acceptance.propostaId || quoteId],
          );
          if (present(event.comentario || acceptance.comentario))
            paragraph("Comentário registrado", event.comentario || acceptance.comentario);
        });
        pair(
          ["Hash do conteúdo aceito", acceptance.hashConteudo],
          ["Versão do aceite", acceptance.versao],
        );
        if (acceptanceSignature) {
          ensureSpace(34);
          var scale = Math.min(55 / acceptanceSignature.width, 20 / acceptanceSignature.height);
          var width = acceptanceSignature.width * scale;
          var height = acceptanceSignature.height * scale;
          doc.addImage(
            acceptanceSignature.data,
            "PNG",
            margin + 3,
            y,
            width,
            height,
            undefined,
            "FAST",
          );
          y += height + 4;
          doc.setDrawColor.apply(doc, theme.line);
          doc.line(margin + 2, y, margin + 72, y);
          font(7, "bold", theme.muted);
          doc.text("ASSINATURA DIGITAL DO RESPONSÁVEL", margin + 2, y + 4);
          y += 9;
        }
      }

      drawHeader(true);
      drawIssuer();
      sectionHeading("Dados do cliente e proposta");
      var clientName =
        client.razaoSocial || client.nome || client.nomeFantasia || "Cliente não informado";
      var branch = client.filial || client.nomeFantasia;
      pair(
        ["Cliente", clientName],
        ["Filial / unidade", branch && branch !== clientName ? branch : ""],
      );
      pair(
        ["CNPJ / CPF", client.cnpj || client.cpf],
        ["Data da proposta", formatDate(source.data)],
      );
      pair(
        ["E-mail", client.email],
        ["Telefone", client.telefone || client.celular || client.whatsapp],
      );
      var clientAddress =
        address(client.endereco || client.address || client.address_json) ||
        address({
          logradouro: client.logradouro,
          numero: client.numero,
          complemento: client.complemento,
          bairro: client.bairro,
          cidade: client.cidade || client.municipio,
          uf: client.estado || client.uf,
          cep: client.cep,
        });
      if (clientAddress) paragraph("Endereço do cliente", clientAddress);
      if (title) {
        font(11, "bold", theme.navy);
        var titleLines = wrap(title, contentWidth - 4, 11, "bold");
        ensureSpace(titleLines.length * 5 + 6);
        doc.text(titleLines, margin + 2, y + 3);
        y += titleLines.length * 5 + 6;
      }
      pair(["Validade", source.validade || "A combinar"], ["Status", status]);
      pair(
        ["Condição de pagamento", source.pagamento || "A combinar"],
        ["Equipamento / referência", source.equipamentoNome || source.equipamentoTag || ""],
      );

      sectionHeading("Itens e valores");
      tableHead();
      rows.forEach(drawItem);
      drawTotals();

      if (present(source.desc || source.observacoes || source.observations)) {
        sectionHeading("Validade e condições comerciais");
        paragraph(
          "Condições e observações",
          source.desc || source.observacoes || source.observations,
        );
      } else {
        sectionHeading("Validade e condições comerciais");
        paragraph(
          "Condições comerciais",
          "Validade: " +
            (source.validade || "A combinar") +
            "\nPagamento: " +
            (source.pagamento || "A combinar"),
        );
      }

      drawAcceptance();
      ensureSpace(16);
      font(7, "bold", theme.navy);
      doc.text("ASSINATURAS", margin, y + 2.5);
      var signatureY = y + 9.5;
      doc.setDrawColor.apply(doc, theme.muted);
      doc.line(margin + 2, signatureY, margin + 78, signatureY);
      doc.line(pageWidth - margin - 78, signatureY, pageWidth - margin - 2, signatureY);
      font(7, "normal", theme.muted);
      doc.text("Nome e assinatura do responsável", margin + 2, signatureY + 4);
      doc.text("Data: ____/____/________", pageWidth - margin - 78, signatureY + 4);
      y = signatureY + 6;

      var totalPages = doc.internal.getNumberOfPages();
      for (var page = 1; page <= totalPages; page++) {
        doc.setPage(page);
        doc.setDrawColor.apply(doc, theme.line);
        doc.setLineWidth(0.25);
        doc.line(margin, 285, pageWidth - margin, 285);
        font(7, "normal", theme.muted);
        doc.text("DBS AIR · DBS Control", margin, 291);
        var footerId = "Proposta " + quoteId;
        if (doc.getTextWidth(footerId) < 92) doc.text(footerId, 106, 291, { align: "center" });
        doc.text("Página " + page + " de " + totalPages, pageWidth - margin, 291, {
          align: "right",
        });
      }
      return doc;
    });
  }

  window.DbsControlQuotePdf = { generate: generate };
})();
